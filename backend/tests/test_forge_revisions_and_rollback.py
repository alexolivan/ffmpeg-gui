import os
import shutil
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from core.build_manager import BuildManager
from core.forge_revisions import (
    build_recipe_snapshot,
    compute_recipe_diff,
    is_revision_path_valid,
)
from forge.recipes.ffmpeg import FfmpegRecipe
from forge.recipes.icecast2 import IcecastRecipe
from forge.recipes.pipewire import PipeWireRecipe


class TestForgeRevisionsAndRollback(unittest.TestCase):
    def test_snapshot_ignores_cosmetic_and_runtime_auto_keys(self):
        snap_a = build_recipe_snapshot(
            version_tag="n7.1",
            build_options={"libsrt": True, "srt_version": "v1.5.4", "vaapi": True, "nvenc": False},
            sdk_paths={"nvenc_headers": ""},
            software_type="ffmpeg",
        )
        snap_b = build_recipe_snapshot(
            version_tag="n7.1",
            build_options={
                "libsrt": True,
                "srt_version": "v1.5.4",
                "vaapi": True,
                "libfdk_aac": True,
                "libpulse": True,
            },
            sdk_paths={"vaapi": "2.20.0"},
            software_type="ffmpeg",
        )
        self.assertEqual(snap_a, snap_b)
        self.assertEqual(compute_recipe_diff(snap_a, snap_b), [])

    def test_compute_recipe_diff_all_features(self):
        base = build_recipe_snapshot(
            version_tag="n7.1",
            build_options={"libsrt": True, "srt_version": "v1.5.3", "nvenc": True, "ndi": True},
            sdk_paths={"nvenc_headers": "n13.1.15.0", "ndi": "6.0.0", "ndi_patch_file": "p1.patch"},
        )
        target = build_recipe_snapshot(
            version_tag="n8.0",
            build_options={
                "libsrt": True,
                "srt_version": "v1.5.4",
                "nvenc": True,
                "vaapi": True,
                "decklink": True,
                "cuda_filters": True,
                "whip": True,
            },
            sdk_paths={"nvenc_headers": "n12.2.72.0", "decklink": "14.2.1"},
        )
        diffs = compute_recipe_diff(base, target)
        by_field = {d["field"]: d for d in diffs}
        self.assertEqual(by_field["version"], {"field": "version", "from": "n7.1", "to": "n8.0"})
        self.assertEqual(by_field["srt"], {"field": "srt", "from": "v1.5.3", "to": "v1.5.4"})
        self.assertEqual(by_field["nvenc"], {"field": "nvenc", "from": "n13.1.15.0", "to": "n12.2.72.0"})
        self.assertEqual(by_field["vaapi"], {"field": "vaapi", "from": None, "to": "enabled"})
        self.assertEqual(by_field["ndi"], {"field": "ndi", "from": "6.0.0", "to": None})
        self.assertEqual(by_field["ndi_patch"], {"field": "ndi_patch", "from": "p1.patch", "to": None})
        self.assertEqual(by_field["decklink"], {"field": "decklink", "from": None, "to": "14.2.1"})
        self.assertEqual(by_field["cuda_filters"], {"field": "cuda_filters", "from": None, "to": "enabled"})
        self.assertEqual(by_field["whip"], {"field": "whip", "from": None, "to": "enabled"})

    def test_sanitize_max_jobs_clamps_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            bm = BuildManager(tmp)
            with patch("core.build_manager.os.cpu_count", return_value=8):
                self.assertEqual(bm.sanitize_max_jobs(0), 1)
                self.assertEqual(bm.sanitize_max_jobs(-3), 1)
                self.assertEqual(bm.sanitize_max_jobs(99), 8)
                self.assertEqual(bm.sanitize_max_jobs(2), 2)
                self.assertEqual(bm.sanitize_max_jobs(None), 4)

    def test_is_revision_path_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            bin_file = os.path.join(tmp, "ffmpeg")
            with open(bin_file, "w") as f:
                f.write("#!/bin/sh\n")
            self.assertTrue(is_revision_path_valid({"install_path": tmp, "binary_path": bin_file}))
            self.assertFalse(is_revision_path_valid({"install_path": tmp, "binary_path": os.path.join(tmp, "missing")}))
            self.assertFalse(is_revision_path_valid(None))

    def test_cleanup_old_revisions_keeps_active_and_backup_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            bm = BuildManager(tmp)
            active_rev = os.path.join(bm.get_revisions_root(1), "rev_active")
            backup_rev = os.path.join(bm.get_revisions_root(1), "rev_backup")
            stale_rev = os.path.join(bm.get_revisions_root(1), "rev_stale")
            legacy_dir = bm.get_install_path(1)
            for d in (active_rev, backup_rev, stale_rev, legacy_dir):
                os.makedirs(d, exist_ok=True)

            bm.cleanup_old_revisions(1, keep_paths=[active_rev, backup_rev])
            self.assertTrue(os.path.isdir(active_rev))
            self.assertTrue(os.path.isdir(backup_rev))
            self.assertFalse(os.path.exists(stale_rev))
            self.assertFalse(os.path.exists(legacy_dir))


class TestBuildManagerStagingAndThrottling(unittest.IsolatedAsyncioTestCase):
    async def test_run_build_stages_into_revision_and_cleans_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            bm = BuildManager(tmp)
            prior_rev = bm.get_revision_install_path(1, rev_id="rev_prev")
            os.makedirs(os.path.join(prior_rev, "bin"), exist_ok=True)
            prior_bin = os.path.join(prior_rev, "bin", "ffmpeg")
            with open(prior_bin, "w") as f:
                f.write("working")

            logs = []

            async def _log(msg):
                logs.append(msg)

            mock_recipe = MagicMock()

            async def _fail_compile(build_id, version_tag, options, sdk_paths, install_path, log_callback):
                self.assertIn("revisions/rev_", install_path)
                self.assertEqual(bm.get_max_jobs(), 2)
                return {"success": False, "error": "boom"}

            mock_recipe.compile = _fail_compile

            with patch("forge.recipes.get_recipe", return_value=mock_recipe):
                res = await bm.run_build(
                    build_id=1,
                    ffmpeg_version="n7.1",
                    srt_version=None,
                    options={},
                    sdk_paths=None,
                    sources_cleaned=False,
                    log_callback=_log,
                    max_jobs=2,
                    low_priority=True,
                )

            self.assertFalse(res["success"])
            # Previous working revision must remain completely untouched
            self.assertTrue(os.path.isfile(prior_bin))
            # Staging failure dir must have been cleaned up (only rev_prev left)
            revs = os.listdir(bm.get_revisions_root(1))
            self.assertEqual(revs, ["rev_prev"])

    async def test_recipes_respect_runner_max_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            bm = BuildManager(tmp)
            bm._active_max_jobs = 2
            bm.check_dependencies = MagicMock(return_value={"dependencies": {}})
            bm._get_command_output = AsyncMock(return_value="version ok")

            recorded_cmds = []

            async def _record_cmd(cmd, log_callback, cwd=None, env=None, ignore_errors=False):
                recorded_cmds.append(list(cmd))
                return 0

            bm._run_logged_cmd = _record_cmd

            # FFmpeg recipe
            ff_recipe = FfmpegRecipe(tmp, runner=bm)
            ff_recipe.run_hw_smoke_tests = AsyncMock(return_value=[])
            ff_install = bm.get_revision_install_path(1, rev_id="rev_ff")
            os.makedirs(os.path.join(ff_install, "bin"), exist_ok=True)
            with open(os.path.join(ff_install, "bin", "ffmpeg"), "w") as f:
                f.write("ok")
            await ff_recipe.compile(1, "n7.1", {"libsrt": True, "srt_version": "v1.5.4"}, None, ff_install, AsyncMock())

            self.assertTrue(any(cmd == ["make", "-j2"] for cmd in recorded_cmds))
            self.assertFalse(any(cmd == ["make", "-j4"] for cmd in recorded_cmds))

            # PipeWire recipe
            recorded_cmds.clear()
            pw_recipe = PipeWireRecipe(tmp, runner=bm)
            pw_install = bm.get_revision_install_path(2, rev_id="rev_pw")
            os.makedirs(os.path.join(pw_install, "bin"), exist_ok=True)
            with open(os.path.join(pw_install, "bin", "pipewire"), "w") as f:
                f.write("ok")
            await pw_recipe.compile(2, "1.2.0", {}, None, pw_install, AsyncMock())
            ninja_cmds = [cmd for cmd in recorded_cmds if "ninja" in cmd[0]]
            self.assertTrue(ninja_cmds and "-j2" in ninja_cmds[0])

            # Icecast2 recipe (with stubbed archive/directory)
            recorded_cmds.clear()
            ice_recipe = IcecastRecipe(tmp, runner=bm)
            ice_install = bm.get_revision_install_path(3, rev_id="rev_ice")
            os.makedirs(os.path.join(ice_install, "bin"), exist_ok=True)
            with open(os.path.join(ice_install, "bin", "icecast"), "w") as f:
                f.write("ok")
            ice_src = os.path.join(bm.get_src_path(3), "icecast-2.4.4")
            os.makedirs(ice_src, exist_ok=True)
            with open(os.path.join(ice_src, "configure"), "w") as f:
                f.write("#!/bin/sh\n")
            with patch("tarfile.open") as mock_tar:
                mock_tar.return_value.__enter__.return_value.extractall = MagicMock()
                await ice_recipe.compile(3, "2.4.4", {}, None, ice_install, AsyncMock())
            self.assertTrue(any(cmd == ["make", "-j2"] for cmd in recorded_cmds))


class TestForgeRollbackAndSerialize(unittest.TestCase):
    def test_serialize_and_rollback_restore_previous_revision(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from database.models import Base, SoftwareBuild
        from main import rollback_build, _serialize_build

        with tempfile.TemporaryDirectory() as tmp:
            rev_old = os.path.join(tmp, "1", "revisions", "rev_old")
            rev_new = os.path.join(tmp, "1", "revisions", "rev_new")
            src_dir = os.path.join(tmp, "1", "src")
            for d in (os.path.join(rev_old, "bin"), os.path.join(rev_new, "bin"), src_dir):
                os.makedirs(d, exist_ok=True)
            bin_old = os.path.join(rev_old, "bin", "ffmpeg")
            bin_new = os.path.join(rev_new, "bin", "ffmpeg")
            with open(bin_old, "w") as f:
                f.write("old-bin")
            with open(bin_new, "w") as f:
                f.write("new-bin")

            engine = create_engine("sqlite:///:memory:")
            Base.metadata.create_all(engine)
            Session = sessionmaker(bind=engine)
            with Session() as db:
                snap_old = build_recipe_snapshot("n7.1", {"libsrt": True, "srt_version": "v1.5.3"}, None, "ffmpeg")
                snap_new = build_recipe_snapshot("n8.0", {"libsrt": True, "srt_version": "v1.5.4", "vaapi": True}, None, "ffmpeg")
                edited_opts = {"libsrt": True, "srt_version": "v1.5.4", "vaapi": True, "nvenc": True}

                b = SoftwareBuild(
                    name="TestFF",
                    software_type="ffmpeg",
                    source_type="compiled",
                    version_tag="n8.0",
                    build_options=edited_opts,
                    install_path=rev_new,
                    binary_path=bin_new,
                    status="ready",
                    sources_cleaned=False,
                    compiled_snapshot=snap_new,
                    previous_revision={
                        "install_path": rev_old,
                        "binary_path": bin_old,
                        "version_tag": "n7.1",
                        "version_output": "ffmpeg n7.1",
                        "built_at": "2026-11-26T10:00:00",
                        "snapshot": snap_old,
                        "raw_build_options": {"libsrt": True, "srt_version": "v1.5.3"},
                        "raw_sdk_paths": None,
                    },
                )
                db.add(b)
                db.commit()
                db.refresh(b)

                # Before rollback: pending edit nvenc should mark needs_recompile=True and can_rollback=True
                ser_before = _serialize_build(b)
                self.assertTrue(ser_before["needs_recompile"])
                self.assertTrue(ser_before["can_rollback"])
                self.assertEqual([d["field"] for d in ser_before["pending_changes"]], ["nvenc"])
                self.assertEqual(ser_before["rollback_info"]["version_tag"], "n7.1")

                # Execute rollback endpoint function directly
                with patch("main.build_manager", BuildManager(tmp)):
                    res = rollback_build(b.id, db=db)

                self.assertEqual(res["status"], "ok")
                ser_after = res["build"]
                self.assertEqual(ser_after["version_tag"], "n7.1")
                self.assertEqual(ser_after["install_path"], rev_old)
                self.assertFalse(ser_after["can_rollback"])
                self.assertFalse(ser_after["needs_recompile"])
                self.assertTrue(ser_after["sources_cleaned"])
                self.assertFalse(os.path.exists(src_dir))
                self.assertFalse(os.path.exists(rev_new))
                self.assertTrue(os.path.isfile(bin_old))
