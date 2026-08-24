from .ffmpeg import FfmpegRecipe
from .icecast2 import IcecastRecipe
from .mediamtx import MediaMtxRecipe
from .kiosk_cog import KioskRecipe
from .decklink_tools import DecklinkToolsRecipe

def get_recipe(software_type: str, builds_root: str, runner=None):
    """Retorna una instancia de la receta correspondiente al software_type."""
    recipes = {
        'ffmpeg': FfmpegRecipe,
        'icecast2': IcecastRecipe,
        'mediamtx': MediaMtxRecipe,
        'kiosk_cog': KioskRecipe,
        'decklink_tools': DecklinkToolsRecipe,
    }
    recipe_class = recipes.get(software_type, FfmpegRecipe)
    return recipe_class(builds_root, runner)


def get_recipe_version(software_type: str) -> str | None:
    """Retorna la versión actual definida en la receta de software."""
    recipes = {
        'ffmpeg': FfmpegRecipe,
        'icecast2': IcecastRecipe,
        'mediamtx': MediaMtxRecipe,
        'kiosk_cog': KioskRecipe,
        'decklink_tools': DecklinkToolsRecipe,
    }
    recipe_class = recipes.get(software_type)
    if recipe_class and hasattr(recipe_class, 'VERSION'):
        return getattr(recipe_class, 'VERSION')
    return None

