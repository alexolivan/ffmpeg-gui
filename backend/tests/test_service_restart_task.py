import unittest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from database.db import SessionLocal, init_db
from database.models import ScheduledTask, TaskExecution, TaskExecutionLog, Service
from core.task_manager import TaskManager


class TestServiceRestartTask(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_db()
        self.db = SessionLocal()
        self.mock_pm = MagicMock()
        self.mock_pm.stop_process = AsyncMock(return_value=True)
        self.mock_pm.start_process = AsyncMock(return_value=True)
        self.mock_pm.processes = {}
        self.manager = TaskManager(lambda: SessionLocal(), process_manager=self.mock_pm)

        # Create test services
        self.svc1 = Service(
            name="Playout DeckLink 1",
            service_type="ffmpeg_stream",
            status="running",
            config={"input_config": {}, "output_config": {}}
        )
        self.svc2 = Service(
            name="Playout DeckLink 2",
            service_type="ffmpeg_stream",
            status="stopped",
            config={"input_config": {}, "output_config": {}}
        )
        self.svc3 = Service(
            name="SRT Gateway",
            service_type="ffmpeg_stream",
            status="running",
            config={"input_config": {}, "output_config": {}}
        )
        self.db.add_all([self.svc1, self.svc2, self.svc3])
        self.db.commit()
        self.db.refresh(self.svc1)
        self.db.refresh(self.svc2)
        self.db.refresh(self.svc3)

    async def asyncTearDown(self):
        self.db.query(TaskExecutionLog).delete()
        self.db.query(TaskExecution).delete()
        self.db.query(ScheduledTask).delete()
        self.db.query(Service).filter(Service.id.in_([self.svc1.id, self.svc2.id, self.svc3.id])).delete()
        self.db.commit()
        self.db.close()

    async def test_service_restart_only_if_running_skips_stopped_service(self):
        task = ScheduledTask(
            name="Nightly Playout Maintenance",
            command="system://service_restart",
            is_system=False,
            schedule_type="recurring",
            schedule_cron="0 4 * * *",
            input_config={
                "type": "service_restart",
                "service_ids": [self.svc1.id, self.svc2.id, self.svc3.id],
                "stagger_delay_seconds": 0,
                "only_if_running": True
            },
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()

        await self.manager._run_system_task(execution.id, task.command)

        # Refresh execution from DB
        self.db.expire_all()
        ex = self.db.query(TaskExecution).get(execution.id)
        self.assertEqual(ex.status, "finished")

        # Verify calls: svc1 and svc3 restarted, svc2 skipped
        called_ids = [call.args[0] for call in self.mock_pm.stop_process.call_args_list]
        self.assertIn(self.svc1.id, called_ids)
        self.assertIn(self.svc3.id, called_ids)
        self.assertNotIn(self.svc2.id, called_ids)

        logs = self.db.query(TaskExecutionLog).filter(TaskExecutionLog.execution_id == execution.id).all()
        log_texts = [l.message for l in logs]
        self.assertTrue(any("Playout DeckLink 2" in t and "skipped" in t.lower() for t in log_texts))

    async def test_service_restart_missing_service_warns_and_continues(self):
        task = ScheduledTask(
            name="Tolerant Maintenance",
            command="system://service_restart",
            is_system=False,
            schedule_type="manual",
            input_config={
                "type": "service_restart",
                "service_ids": [999999, self.svc1.id],
                "stagger_delay_seconds": 0,
                "only_if_running": True
            },
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()

        await self.manager._run_system_task(execution.id, task.command)

        self.db.expire_all()
        ex = self.db.query(TaskExecution).get(execution.id)
        self.assertEqual(ex.status, "finished")

        # Svc1 restarted
        called_ids = [call.args[0] for call in self.mock_pm.stop_process.call_args_list]
        self.assertEqual(called_ids, [self.svc1.id])

        logs = self.db.query(TaskExecutionLog).filter(TaskExecutionLog.execution_id == execution.id).all()
        log_texts = [l.message for l in logs]
        self.assertTrue(any("999999" in t and ("not found" in t.lower() or "missing" in t.lower()) for t in log_texts))

    async def test_service_restart_abort_mid_cascade(self):
        task = ScheduledTask(
            name="Abortable Maintenance",
            command="system://service_restart",
            is_system=False,
            schedule_type="manual",
            input_config={
                "type": "service_restart",
                "service_ids": [self.svc1.id, self.svc3.id],
                "stagger_delay_seconds": 1,
                "only_if_running": True
            },
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()

        # Abort during stagger delay after svc1
        original_start = self.mock_pm.start_process
        async def stop_after_svc1(*args, **kwargs):
            res = await original_start(*args, **kwargs)
            if args and args[0] == self.svc1.id:
                await self.manager.stop_execution(execution.id)
            return res
        self.mock_pm.start_process = AsyncMock(side_effect=stop_after_svc1)

        await self.manager._run_system_task(execution.id, task.command)

        self.db.expire_all()
        ex = self.db.query(TaskExecution).get(execution.id)
        self.assertEqual(ex.status, "stopped")

        # Svc3 must not have been restarted
        called_ids = [call.args[0] for call in self.mock_pm.stop_process.call_args_list]
        self.assertEqual(called_ids, [self.svc1.id])

    async def test_service_restart_partial_failure_continues_and_marks_error(self):
        task = ScheduledTask(
            name="Failing Playout Maintenance",
            command="system://service_restart",
            is_system=False,
            schedule_type="manual",
            input_config={
                "type": "service_restart",
                "service_ids": [self.svc1.id, self.svc3.id],
                "stagger_delay_seconds": 0,
                "only_if_running": True
            },
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        execution = TaskExecution(task_id=task.id, status="pending")
        self.db.add(execution)
        self.db.commit()

        async def start_with_fail(svc_id, *args, **kwargs):
            if svc_id == self.svc1.id:
                return False
            return True
        self.mock_pm.start_process = AsyncMock(side_effect=start_with_fail)

        await self.manager._run_system_task(execution.id, task.command)

        self.db.expire_all()
        ex = self.db.query(TaskExecution).get(execution.id)
        self.assertEqual(ex.status, "error")

        # Both svc1 and svc3 were attempted
        called_ids = [call.args[0] for call in self.mock_pm.stop_process.call_args_list]
        self.assertIn(self.svc1.id, called_ids)
        self.assertIn(self.svc3.id, called_ids)


class TestServiceRestartAPI(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        from fastapi.testclient import TestClient
        from main import app
        self.client = TestClient(app)

    def tearDown(self):
        self.db.query(ScheduledTask).filter(ScheduledTask.name.like("API Test %")).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_create_update_and_serialize_service_restart_task(self):
        payload = {
            "name": "API Test Nightly Restart",
            "command": "system://service_restart",
            "is_active": True,
            "schedule_type": "recurring",
            "schedule_cron": "0 4 * * *",
            "input_config": {
                "type": "service_restart",
                "service_ids": [101, 102],
                "stagger_delay_seconds": 5,
                "only_if_running": True
            },
            "output_config": {},
            "codec_config": {}
        }
        res = self.client.post("/tasks", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["command"], "system://service_restart")
        self.assertEqual(data["name"], "API Test Nightly Restart")
        self.assertEqual(data["input_config"]["service_ids"], [101, 102])
        task_id = data["id"]

        # PUT update
        update_payload = {
            "input_config": {
                "type": "service_restart",
                "service_ids": [102, 103],
                "stagger_delay_seconds": 10,
                "only_if_running": False
            }
        }
        put_res = self.client.put(f"/tasks/{task_id}", json=update_payload)
        self.assertEqual(put_res.status_code, 200)
        updated_data = put_res.json()
        self.assertEqual(updated_data["input_config"]["service_ids"], [102, 103])
        self.assertEqual(updated_data["input_config"]["stagger_delay_seconds"], 10)
        self.assertEqual(updated_data["command"], "system://service_restart")

    def test_clone_service_restart_task_as_service_rejected(self):
        task = ScheduledTask(
            name="API Test Service Restarter",
            command="system://service_restart",
            is_system=False,
            schedule_type="manual",
            input_config={"type": "service_restart", "service_ids": [1]},
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        res = self.client.post(f"/tasks/{task.id}/clone-as-service")
        self.assertEqual(res.status_code, 400)
        self.assertIn("cannot be cloned", res.json()["detail"].lower())

    def test_export_and_import_service_restart_task(self):
        task = ScheduledTask(
            name="API Test Export Restart",
            command="system://service_restart",
            is_system=False,
            schedule_type="recurring",
            schedule_cron="30 3 * * *",
            input_config={
                "type": "service_restart",
                "service_ids": [10, 20],
                "stagger_delay_seconds": 7,
                "only_if_running": True
            },
            output_config={},
            codec_config={}
        )
        self.db.add(task)
        self.db.commit()

        # Export single
        exp_res = self.client.get(f"/tasks/{task.id}/export")
        self.assertEqual(exp_res.status_code, 200)
        exp_data = exp_res.json()["task"]
        self.assertEqual(exp_data.get("command"), "system://service_restart")
        self.assertEqual(exp_data["input_config"]["service_ids"], [10, 20])

        # Import
        imp_payload = {
            "version": 2,
            "tasks": [exp_data]
        }
        imp_res = self.client.post("/tasks/import", json=imp_payload)
        self.assertEqual(imp_res.status_code, 200)

        imported = self.db.query(ScheduledTask).filter(ScheduledTask.name.like("%Export Restart%")).all()
        self.assertTrue(any(t.command == "system://service_restart" for t in imported))
