# Documento de Especificación de Requisitos (DER)
## Proyecto: Orquestador y GUI para FFMPEG (Standalone/P2P)

**Versión:** 1.0
**Rol Responsable:** Arquitecto de Sistemas / Analista de Requisitos Senior
**Entorno Objetivo:** Linux (Debian Based - Agnóstico a repositorios)

---

## 1. Introducción y Alcance
Este documento define los requisitos técnicos y funcionales para el desarrollo de una plataforma de orquestación de procesos de media basada en FFMPEG. El sistema se comporta como un nodo independiente (standalone) con capacidades de facilitar la interconexión manual entre pares (P2P/PMP).

---

## 2. Fase 0: Triaje Metodológico
El sistema se divide en dos grandes bloques con aproximaciones de diseño diferenciadas:

1.  **Componentes "Hard" (Backend/Core):** Tratados bajo especificación técnica formal (IEEE 830). Foco en estabilidad, gestión de procesos y compilación.
2.  **Componentes "Soft" (Frontend/UI):** Tratados mediante Historias de Usuario (Agile). Foco en usabilidad, diseño moderno y flujos de trabajo.

---

## 3. Especificaciones Técnicas (Componentes "Hard")

### 3.1. Arquitectura de Backend
- **Lenguaje:** Python 3 (uso de `pip3` para dependencias, evitando librerías del sistema operativo).
- **Gestión de Procesos:** Implementación de un Process Manager propio en Python. **No se utilizará systemd** para evitar inconsistencias por manipulación externa.
- **Persistencia:** Base de datos ligera (SQLite) o archivos estructurados (JSON).
- **Seguridad:** El software debe instalarse y ejecutarse bajo un usuario sin privilegios (ej. `ffmpeg-user`).

### 3.2. Motor de Procesos y Watchdog
- **Ciclo de Vida:** Capacidad de gestionar "Servicios" (ejecución indefinida con inicio automático on-boot gestionado por la app) y "Batch Jobs" (tareas programadas únicas).
- **Watchdog:** Monitorización multinivel:
    - Estado del PID.
    - Consumo de recursos (CPU/RAM).
    - Verificación activa vía `ffprobe` para flujos de red.
- **Manejo de Señales:** Implementación de "Parada Graciosa" (Graceful Shutdown) enviando `SIGTERM` o comando `q` vía stdin para asegurar la integridad de los archivos y streams.

### 3.3. Gestión de Binarios y Compilación
- **Compilación Bare-Metal:** Capacidad de clonar y compilar FFMPEG y dependencias (NDI, Decklink, LibSRT) de forma local.
- **Aislamiento:** Las librerías y SDKs propietarios se mantendrán en directorios locales del software para no ensuciar el `/usr/lib/` del sistema.
- **Portabilidad:** El sistema debe ser capaz de autogestionar sus versiones de FFMPEG sin depender de los repositorios de la distribución.

---

## 4. Alcance Funcional de FFMPEG (Subconjunto de Características)
Para garantizar la simplicidad, el sistema abstraerá FFMPEG en los siguientes bloques:

### 4.1. Orígenes de Señal (Inputs)
- **Banda Base / Hardware:** Dispositivos Decklink (SDI/HDMI), entradas de audio ALSA.
- **Red / IP:** NewTek NDI, LibSRT (Caller/Listener), flujos UDP/RTP (MPEG-TS, PCM lineal).
- **Almacenamiento:** Archivos de media en rutas locales o de red.

### 4.2. Destinos de Señal (Outputs)
- **Banda Base / Hardware:** Salida Decklink.
- **Red / IP (Vídeo):** NDI, LibSRT, UDP (MPEG-TS), RTMP/RTMPS.
- **Red / IP (Audio / Radiodifusión):** Icecast2 (Ogg/Opus/MP3), flujos RTP/UDP de baja latencia (PCM lineal).
- **Almacenamiento:** Grabación en contenedores `.mp4`, `.mkv`, `.mov`.

### 4.3. Códecs y Aceleración por Hardware (HW Accel)
- **Vídeo:** H.264 (AVC), H.265 (HEVC), ProRes, DNxHD.
- **Aceleración Hardware:**
    - **VAAPI:** Soporte genérico Linux (Intel/AMD).
    - **Intel QSV:** Soporte optimizado para Intel Quick Sync.
    - **NVIDIA NVENC/NVDEC:** Soporte para GPUs dedicadas.
- **Audio:** AAC, MP3, Opus, PCM lineal.

### 4.4. Procesamiento y Filtros
- **Vídeo:** Escalado (Resizing), Framerate conversion, Desentrelazado (`yadif`), Overlay de imagen (Logo PNG).
- **Audio:** Resampling, Downmixing (Estéreo a Mono), Extracción de audio (Audio-only pipelines).

---

## 5. Backlog de Historias de Usuario (Componentes "Soft")

### Épica 1: Interfaz y Experiencia de Usuario (Web GUI)
- **US1.1:** Como administrador, quiero una interfaz web moderna, plana y minimalista (LTS oriented) para controlar el sistema de forma remota.
- **US1.2:** Como usuario, quiero un dashboard que resuma la salud de todos los procesos (servicios y batch) en tiempo real.

### Épica 2: Interconexión y Flujos (P2P)
- **US2.1:** Como emisor, quiero exportar la configuración de mi encoder a un archivo de perfil (JSON) para facilitárselo al receptor.
- **US2.2:** Como receptor, quiero importar perfiles de configuración para que el sistema configure automáticamente el decoder sin errores manuales.

### Épica 3: Monitorización y Preview
- **US3.1:** Como operador, quiero ver un "Live Preview" de baja resolución y bajo impacto (WebRTC/WebSockets/MJPEG) para validar que el contenido es correcto.

---

## 6. Requisitos No Funcionales
- **Disponibilidad:** El sistema debe auto-recuperarse tras un reinicio inesperado del hardware (auto-start de servicios críticos).
- **Mantenibilidad:** El código debe ser fácilmente actualizable (Self-upgradeable) desde la propia interfaz.
- **Rendimiento:** El backend debe priorizar (nice/ionice) los procesos de media para no comprometer la respuesta de la GUI.
