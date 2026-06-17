# Especificación de Diseño: Limpieza de Procesos FFmpeg Huérfanos/Rogue

Fecha: 2026-06-17
Estado: Propuesto

## 1. Contexto y Problema
En entornos de producción y desarrollo, los procesos `ffmpeg` iniciados por el backend como servicios de transmisión en vivo o tareas programadas pueden quedar huérfanos (por ejemplo, tras un reinicio inesperado de la aplicación Python o al detener y arrancar de forma secuencial muy rápida).
Dado que estos procesos `ffmpeg` retienen el control de los dispositivos físicos de captura (ALSA, V4L2) y puertos de red (SRT, UDP), cualquier nueva instancia falla silenciosamente al intentar acceder a los recursos ocupados. Además, estos procesos no aparecen en la interfaz de usuario al perderse su referencia de PID en memoria.

## 2. Solución Propuesta (Opción A)
Inyectar marcas de identidad mediante variables de entorno en los subprocesos de FFmpeg e implementar un mecanismo de limpieza utilizando `psutil` para identificar y matar de manera selectiva únicamente los procesos generados por la aplicación.

### 2.1 Marcado de Procesos
Al crear los subprocesos con `asyncio.create_subprocess_exec`, inyectaremos las siguientes variables en el entorno (`env`):
* Para servicios: `"FFMPEG_GUI_PROCESS_ID": str(process_id)`
* Para tareas programadas: `"FFMPEG_GUI_EXECUTION_ID": str(execution_id)`

### 2.2 Helper de Limpieza
Se creará un helper robusto `cleanup_rogue_processes` en `backend/utils/process_utils.py` (o en un módulo equivalente):

```python
import psutil
import os
import signal
import logging

logger = logging.getLogger("ProcessCleanup")

def cleanup_rogue_processes(process_id: int = None, execution_id: int = None, active_pids = None):
    """
    Escanea el sistema y mata selectivamente procesos ffmpeg huérfanos pertenecientes
    a este backend mediante variables de entorno.
    """
    active_pids = active_pids or set()
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            name = proc.info['name']
            if name and 'ffmpeg' in name.lower():
                env = proc.environ()
                pid = proc.info['pid']
                
                gui_proc_id = env.get("FFMPEG_GUI_PROCESS_ID")
                gui_exec_id = env.get("FFMPEG_GUI_EXECUTION_ID")
                
                # Omitir si no fue iniciado por esta aplicación
                if not gui_proc_id and not gui_exec_id:
                    continue
                
                should_kill = False
                reason = ""
                
                if process_id is not None and gui_proc_id == str(process_id):
                    should_kill = True
                    reason = f"coincide con el servicio ID {process_id}"
                elif execution_id is not None and gui_exec_id == str(execution_id):
                    should_kill = True
                    reason = f"coincide con la ejecución de tarea ID {execution_id}"
                elif process_id is None and execution_id is None:
                    # Limpieza global (arranque)
                    if gui_proc_id and pid not in active_pids:
                        should_kill = True
                        reason = f"servicio huérfano (ID {gui_proc_id}) no registrado en memoria"
                    elif gui_exec_id and pid not in active_pids:
                        should_kill = True
                        reason = f"tarea huérfana (ID {gui_exec_id}) no registrada en memoria"
                
                if should_kill:
                    logger.warning(f"Matando proceso ffmpeg huérfano (PID {pid}) debido a: {reason}")
                    try:
                        proc.send_signal(signal.SIGKILL)
                    except Exception as e:
                        logger.error(f"Error al enviar SIGKILL al proceso {pid}: {e}")
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
```

### 2.3 Integración en los Controladores
* **Al Iniciar / Detener Servicios (`ProcessManager`)**:
  * En `start_process`: Invocar `cleanup_rogue_processes(process_id=process_id)` al principio de la función.
  * En `stop_process`: Invocar `cleanup_rogue_processes(process_id=process_id)` como fallback al final si el proceso no responde o tras eliminarlo de la lista activa.
* **Al Iniciar / Detener Tareas (`TaskManager`)**:
  * En `start_execution`: Invocar `cleanup_rogue_processes(execution_id=execution_id)`.
  * En `stop_execution`: Invocar `cleanup_rogue_processes(execution_id=execution_id)` como fallback.
* **En el arranque del servidor (`main.py`)**:
  * Durante el evento `startup` o ciclo inicial, invocar `cleanup_rogue_processes()` de forma global (pasando los PIDs activos que estén registrados en la base de datos como corriendo para recuperarlos o cerrarlos limpiamente).

## 3. Plan de Verificación
* **Pruebas Automatizadas**:
  * Añadir un test unitario mockeando `psutil.process_iter` para validar que `cleanup_rogue_processes` selecciona y mata los procesos correctos basándose en sus variables de entorno.
* **Prueba Manual**:
  * Simular un proceso huérfano forzando la parada del backend sin detener el FFmpeg asociado.
  * Iniciar de nuevo el backend y verificar en los logs que el proceso huérfano es detectado y terminado.
