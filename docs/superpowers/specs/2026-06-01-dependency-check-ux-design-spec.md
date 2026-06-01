# Diseño Técnico: Gestión Inteligente de Dependencias y UX en FFMPEG Forge

**Fecha:** 2026-06-01
**Autor:** Antigravity (Principal Systems Architect)
**Estado:** Aprobado

---

## 1. Contexto y Objetivos

Durante la importación del proyecto a un entorno nuevo, se identificó que la compilación requiere bibliotecas específicas (`libssl-dev`, `libx264-dev`, `libx265-dev`) que no estaban listadas ni comprobadas explícitamente en el mecanismo de pre-flight check del sistema. 

Este diseño tiene como objetivos:
1. **Robustez en Validación:** Monitorizar con precisión tanto las herramientas de compilación obligatorias como las bibliotecas externas de codecs y hardware opcionales.
2. **Alertas Contextuales:** Advertir proactivamente en el formulario de compilación antes de lanzar un build que esté destinado a fallar por falta de dependencias del sistema.
3. **UX Premium y Resolutiva:** Proporcionar al usuario un centro de gestión de dependencias intuitivo que no solo detecte problemas, sino que genere comandos exactos de instalación para su distribución Linux (Debian/Ubuntu, Fedora/RHEL, Arch).

---

## 2. Cambios en el Backend (Capa de Lógica/Datos)

### Archivo: `backend/core/build_manager.py`

Modificar el método `check_dependencies` para:
- Realizar comprobaciones a través de `pkg-config --exists` para `x264`, `x265`, y `openssl`.
- Retornar una estructura rica en metadatos y categorizada:

```python
def check_dependencies(self) -> dict:
    # Comprobación de herramientas del sistema básicas
    # ...
```

Estructura de retorno del API:
```json
{
  "dependencies": {
    "cmake": { "installed": true, "type": "required", "description": "Sistema de generación de builds" },
    "git": { "installed": true, "type": "required", "description": "Control de versiones para clonar repositorios" },
    "make": { "installed": true, "type": "required", "description": "Generador de binarios" },
    "gcc": { "installed": true, "type": "required", "description": "Compilador GNU C/C++" },
    "pkg-config": { "installed": true, "type": "required", "description": "Gestor de metadatos de bibliotecas de desarrollo" },
    "yasm/nasm": { "installed": true, "type": "required", "description": "Ensamblador para optimizaciones x86" },
    "libx264": { "installed": true, "type": "required", "description": "Codificador de video H.264", "pkg_config_name": "x264" },
    "libx265": { "installed": true, "type": "required", "description": "Codificador de video H.265/HEVC", "pkg_config_name": "x265" },
    "libssl": { "installed": false, "type": "optional", "description": "Criptografía para LibSRT", "pkg_config_name": "openssl" },
    "libva": { "installed": false, "type": "optional", "description": "Aceleración por hardware VAAPI (Intel/AMD)", "pkg_config_name": "libva" },
    "libdrm": { "installed": false, "type": "optional", "description": "Acceso directo a renderizado de GPU", "pkg_config_name": "libdrm" }
  },
  "all_required_met": false
}
```

---

## 3. Cambios en el Frontend (Capa de Presentación)

### 3.1. Alertas Contextuales en `BuildFormModal.tsx`
* Leer las dependencias cargadas en el estado global.
* Mostrar banners de color naranja con diseño premium e interactivos cuando falten dependencias asociadas a opciones seleccionadas:
  * Si `options.libsrt` es `true` y `dependencies.libssl.installed` es `false`.
  * Si `options.vaapi` es `true` y `dependencies.libva.installed` o `dependencies.libdrm.installed` es `false`.

### 3.2. Widget de Salud de Entorno y Modal en `App.tsx`
* **Card General:** Reemplazar el banner inline horizontal por un widget de diseño minimalista y elegante:
  * Badge verde si `all_required_met === true`.
  * Badge naranja/rojo si faltan dependencias requeridas.
  * Botón *"Configuración del Entorno"* para abrir un modal.
* **Modal "Gestión de Dependencias del Sistema":**
  * Presentar la lista dividida visualmente en **Requeridas** y **Opcionales**.
  * Selector desplegable para la distribución de Linux (`Debian/Ubuntu`, `Fedora/RHEL/CentOS`, `Arch Linux`).
  * Generación dinámica del comando de consola basado en las dependencias marcadas como `installed: false`:
    - Genera el comando `sudo apt-get install -y <packages>` (o sus equivalentes correspondientes) dinámicamente filtrando sólo los paquetes ausentes.
    - Botón para copiar el comando al portapapeles con un clic.

---

## 4. Plan de Verificación

1. **Pruebas en Backend:** 
   - Invocar directamente el endpoint `/builds/check` y asegurar que la estructura JSON sea idéntica al diseño técnico.
   - Forzar el valor de retorno de ciertas dependencias simulando su ausencia para probar todas las variantes.
2. **Pruebas en Frontend:**
   - Validar que el botón de copia funcione.
   - Validar que el cambio de distro Linux modifique la cadena de comandos en tiempo real.
   - Validar que los banners de advertencia del formulario de builds aparezcan y desaparezcan reactivamente según las opciones seleccionadas.
