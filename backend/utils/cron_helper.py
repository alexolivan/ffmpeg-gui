import datetime
from croniter import croniter

class CronHelper:
    @staticmethod
    def get_next_run(cron_expression: str, base_time: datetime.datetime = None) -> datetime.datetime:
        """Calcula la fecha y hora de la próxima ejecución en base al cron y la fecha base."""
        if not base_time:
            base_time = datetime.datetime.utcnow()
        iter = croniter(cron_expression, base_time)
        return iter.get_next(datetime.datetime)

    @staticmethod
    def validate_cron(cron_expression: str) -> bool:
        """Valida si una expresión cron es sintácticamente correcta."""
        return croniter.is_valid(cron_expression)
