import asyncio
import logging
from datetime import datetime
from database.models import ScheduledTask, TaskExecution
from utils.cron_helper import CronHelper

class Scheduler:
    def __init__(self, db_session_factory, task_manager, poll_interval=5.0):
        self.db_session_factory = db_session_factory
        self.task_manager = task_manager
        self.poll_interval = poll_interval
        self.logger = logging.getLogger("Scheduler")
        self.is_running = False
        self._loop_task = None

    async def start(self):
        """Inicia el bucle en segundo plano del programador."""
        if self.is_running:
            return
        self.is_running = True
        self._loop_task = asyncio.create_task(self._poll_loop())
        self.logger.info("Scheduler started successfully.")

    async def stop(self):
        """Detiene el bucle en segundo plano."""
        if not self.is_running:
            return
        self.is_running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        self.logger.info("Scheduler stopped.")

    async def _poll_loop(self):
        while self.is_running:
            try:
                await self.poll_due_tasks()
            except Exception as e:
                self.logger.exception("Error in scheduler poll cycle")
            await asyncio.sleep(self.poll_interval)

    async def poll_due_tasks(self):
        now = datetime.utcnow()
        with self.db_session_factory() as session:
            # Query active tasks with next_run in the past or now
            due_tasks = (
                session.query(ScheduledTask)
                .filter(
                    ScheduledTask.is_active == True,
                    ScheduledTask.next_run != None,
                    ScheduledTask.next_run <= now
                )
                .all()
            )

            for task in due_tasks:
                self.logger.info(f"Triggering scheduled task: {task.name} (due at {task.next_run})")
                
                # Create execution record
                execution = TaskExecution(
                    task_id=task.id,
                    status="pending",
                    retry_count=0
                )
                session.add(execution)
                
                # Advance scheduling parameters
                if task.schedule_type == 'one_shot':
                    task.next_run = None
                elif task.schedule_type == 'recurring' and task.schedule_cron:
                    try:
                        # Use current time as base for calculating the next run to avoid backlogging past executions
                        task.next_run = CronHelper.get_next_run(task.schedule_cron, now)
                    except Exception as e:
                        self.logger.error(f"Failed to calculate next run for task {task.name}: {e}")
                        task.next_run = None
                        task.is_active = False

                session.commit()
                session.refresh(execution)

                # Fire execution asynchronously
                asyncio.create_task(self.task_manager.start_execution(execution.id))
