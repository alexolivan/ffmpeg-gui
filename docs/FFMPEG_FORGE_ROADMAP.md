# FFMPEG Forge Roadmap & Pending Tasks

Este documento detalla las tareas pendientes y objetivos futuros para el orquestador de compilación de FFmpeg.

## 🛠️ Pendiente de Testeo (SDKs)
- [ ] **Validación Física de DeckLink:** Verificar que el path del SDK incluya correctamente los headers necesarios y que el flag `--enable-decklink` no falle en el linkado final.
- [ ] **Validación Física de NDI:** Comprobar la carga dinámica de la librería NDI en tiempo de ejecución tras la compilación.
- [ ] **Validación de NVENC:** Confirmar que los headers de NVIDIA coincidan con los drivers instalados en el host.

## 🚀 Mejoras de UX Sugeridas
- [ ] **Asistente de Carga de SDK (Upload Assist):** Implementar un botón en el GUI para subir archivos `.zip` o `.tar.gz` de los SDKs, que el servidor descomprima automáticamente en una ruta predefinida.
- [ ] **Pre-compilación de Headers:** Automatizar la descarga de `nv-codec-headers` para evitar que el usuario tenga que buscarlos manualmente.
- [ ] **Streaming de Logs mejorado:** Añadir botones de "Download Logs" y "Search" en el terminal de compilación.

## 📺 Próximas Funcionalidades (Broadcast Testing)
- [ ] **Soporte para `lavfi` Inputs:** 
    - [ ] Generador de Carta de Ajuste (`testsrc`).
    - [ ] Generador de Tono de 1Khz (`sine`).
    - [ ] Ruido Rosa/Blanco (`anoisesrc`).
    - [ ] Integración en el formulario de creación de procesos como un tipo de input "Internal Generator".

## 🛡️ Robustez y Seguridad
- [ ] **Aislamiento por Contenedores:** Estudiar la posibilidad de compilar dentro de contenedores temporales para no "ensuciar" el sistema host con dependencias de desarrollo.
- [ ] **Cache de Compilación:** Implementar `ccache` para acelerar recompilaciones del mismo perfil.
