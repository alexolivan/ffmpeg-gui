import datetime
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.build_manager import BuildManager
from core.forge_executor import execute_forge_build_pipeline
from core.forge_revisions import build_recipe_snapshot
from core.task_manager import TaskManager
from database.models import Base, ScheduledTask, SoftwareBuild, TaskExecution


class TestForgeExecutorAndTask(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.db_engine)
        self.Session = sessionmaker(bind=self.db_engine)
        self.bm = BuildManager(self.tmp_dir.name)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def _create_ready_build(self, name="MainFF", version_tag="n7.1", edited=False):
        with self.Session() as db:
            b = SoftwareBuild(
                name=name,
                software_type="ffmpeg",
                source_type="compiled",
                version_tag=version_tag,
                build_options={"libsrt": True, "srt_version": "v1.5.3"},
                status="ready",
            )
            db.add(b)
            db.commit()
            db.refresh(b)

            rev_dir = self.bm.get_revision_install_path(b.id, rev_id="rev_initial")
            os.makedirs(os.path.join(rev_dir, "bin"), exist_ok=True)
            bin_file = os.path.join(rev_dir, "bin", "ffmpeg")
            with open(bin_file, "w") as f:
                f.write("initial-bin")

            snap = build_recipe_snapshot(
                version_tag, {"libsrt": True, "srt_version": "v1.5.3"}, None, "ffmpeg"
            )
            b.install_path = rev_dir
            b.binary_path = bin_file
            b.compiled_snapshot = snap
            if edited:
                b.build_options = {"libsrt": True, "srt_version": "v1.5.4", "vaapi": True}
            db.commit()
            return b.id, rev_dir, bin_file

    async def test_execute_forge_build_pipeline_success_and_failure_preservation(self):
        build_id, rev_initial, bin_initial = self._create_ready_build(edited=True)

        # 1. Simulate failed compile -> must keep status="ready", old binary intact, set last_compile_error
        fail_mock = AsyncMock(return_value={"success": False, "error": "compiler error"})
        with patch.object(self.bm, "run_build", fail_mock):
            res_fail = await execute_forge_build_pipeline(
                build_id,
                self.Session,
                self.bm,
                clean=True,
                max_jobs=2,
                low_priority=True,
            )
        self.assertFalse(res_fail["success"])
        with self.Session() as db:
            b = db.query(SoftwareBuild).get(build_id)
            self.assertEqual(b.status, "ready")
            self.assertEqual(b.install_path, rev_initial)
            self.assertEqual(b.last_compile_error, "compiler error")
            self.assertIsNone(b.previous_revision)

        # 2. Simulate successful compile -> swaps install_path, stores rev_initial in previous_revision
        new_rev = self.bm.get_revision_install_path(build_id, rev_id="rev_new")
        os.makedirs(os.path.join(new_rev, "bin"), exist_ok=True)
        new_bin = os.path.join(new_rev, "bin", "ffmpeg")
        with open(new_bin, "w") as f:
            f.write("new-bin")

        ok_mock = AsyncMock(
            return_value={
                "success": True,
                "install_path": new_rev,
                "binary_path": new_bin,
                "version_output": "ffmpeg n7.1",
                "build_options": {"libsrt": True, "srt_version": "v1.5.4", "vaapi": True},
                "sdk_paths": None,
                "hw_checks": [],
            }
        )
        with patch.object(self.bm, "run_build", ok_mock):
            res_ok = await execute_forge_build_pipeline(
                build_id,
                self.Session,
                self.bm,
                clean=True,
                max_jobs=2,
                low_priority=True,
            )
        self.assertTrue(res_ok["success"])
        with self.Session() as db:
            b = db.query(SoftwareBuild).get(build_id)
            self.assertEqual(b.status, "ready")
            self.assertEqual(b.install_path, new_rev)
            self.assertIsNone(b.last_compile_error)
            self.assertEqual(b.previous_revision["install_path"], rev_initial)
            self.assertTrue(os.path.isfile(bin_initial))

    async def test_task_manager_all_pending_and_selected_filtering(self):
        synced_id, _, _ = self._create_ready_build(name="Synced", edited=False)
        pending_id, _, _ = self._create_ready_build(name="Edited", edited=True)

        tm = TaskManager(db_session_factory=self.Session, build_manager=self.bm)
        with self.Session() as db:
            task = ScheduledTask(
                name="Nightly Build",
                command="system://forge_build",
                input_config={"type": "forge_build", "target_mode": "all_pending", "max_jobs": 2, "low_priority": True, "clean": True},
                output_config={},
                codec_config={},
                schedule_type="recurring",
                schedule_cron="0 3 * * *",
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            ex = TaskExecution(task_id=task.id, status="running")
            db.add(ex)
            db.commit()
            db.refresh(ex)
            exec_id = ex.id

        called_ids = []

        async def _fake_pipeline(bid, db_factory, bm, **kwargs):
            called_ids.append((bid, kwargs.get("max_jobs"), kwargs.get("low_priority"), kwargs.get("clean")))
            return {"success": True, "build_id": bid, "build_name": "Edited", "error": None, "hw_checks": []}

        logs = []
        with patch("core.forge_executor.execute_forge_build_pipeline", side_effect=_fake_pipeline):
            ok = await tm._execute_forge_build(
                exec_id,
                {"target_mode": "all_pending", "max_jobs": 2, "low_priority": True, "clean": True},
                logs.append,
                logs.append,
                logs.append,
            )

        self.assertTrue(ok)
        self.assertEqual(called_ids, [(pending_id, 2, True, True)])

        # Now run selected on Synced with only_if_pending=True -> must skip all & succeed
        called_ids.clear()
        with patch("core.forge_executor.execute_forge_build_pipeline", side_effect=_fake_pipeline):
            ok_skip = await tm._execute_forge_build(
                exec_id,
                {"target_mode": "selected", "build_ids": [synced_id], "only_if_pending": True},
                logs.append,
                logs.append,
                logs.append,
            )
        self.assertTrue(ok_skip)
        self.assertEqual(called_ids, [])

        # Abort before execution starts -> must return False without compiling
        tm._aborted_executions.add(exec_id)
        with patch("core.forge_executor.execute_forge_build_pipeline", side_effect=_fake_pipeline):
            ok_abort = await tm._execute_forge_build(
                exec_id,
                {"target_mode": "selected", "build_ids": [synced_id], "only_if_pending": False},
                logs.append,
                logs.append,
                logs.append,
            )
        self.assertFalse(ok_abort)
        self.assertEqual(called_ids, [])

    def test_serialize_build_includes_active_scheduled_forge_task(self):
        from main import _get_active_forge_schedule_map, _serialize_build

        build_id, _, _ = self._create_ready_build(name="ScheduledFF", edited=True)
        with self.Session() as db:
            next_dt = datetime.datetime(2026, 11, 28, 3, 0, 0)
            task = ScheduledTask(
                name="Forge Nightly: ScheduledFF",
                command="system://forge_build",
                is_active=True,
                input_config={
                    "type": "forge_build",
                    "target_mode": "selected",
                    "build_ids": [build_id],
                    "max_jobs": 2,
                },
                output_config={},
                codec_config={},
                schedule_type="one_shot",
                schedule_datetime=next_dt,
                next_run=next_dt,
            )
            db.add(task)
            db.commit()
            builds = db.query(SoftwareBuild).all()
            sched_map = _get_active_forge_schedule_map(db, builds=builds)
            ser = _serialize_build(builds[0], scheduled_forge_tasks=sched_map)
            self.assertIsNotNone(ser["scheduled_build"])
            self.assertEqual(ser["scheduled_build"]["task_name"], "Forge Nightly: ScheduledFF")
            self.assertEqual(ser["scheduled_build"]["max_jobs"], 2)
