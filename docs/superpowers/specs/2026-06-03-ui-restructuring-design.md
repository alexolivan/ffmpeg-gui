# Especificación de Diseño: Reestructuración de la Interfaz de Usuario y Detección de Hardware

## 1. Introducción
Este documento especifica los cambios de diseño para reorganizar y estructurar adecuadamente la interfaz de usuario de `ffmpeg-gui`. El objetivo principal es separar las responsabilidades de visualización y monitoreo (Dashboard) de las responsabilidades de control de flujos de trabajo de transmisión continua (Services), así como centralizar la información del sistema y reportar dinámicamente el soporte de hardware del nodo de computación.

## 2. Requerimientos y Cambios en el Backend (API)

### 2.1 Endpoint de Capacidades de Hardware
Se implementará un nuevo endpoint `GET /system/capabilities` en el backend para reportar dinámicamente si los controladores, dispositivos y bibliotecas de codecs físicos están disponibles en el host Linux.

* **VAAPI**:
  - Detección: Existencia de `/dev/dri` y presencia de archivos que coincidan con `renderD*` o `card*`.
  - Propósito: Aceleración de hardware Intel/AMD.
* **NVENC**:
  - Detección: `shutil.which("nvidia-smi") is not None` o existencia de `/dev/nvidia0`.
  - Propósito: Codificación acelerada por hardware de NVIDIA.
* **V4L2 (Video4Linux)**:
  - Detección: Búsqueda de dispositivos mediante el patrón `/dev/video*` usando `glob.glob()`.
  - Propósito: Captura de cámaras web, tarjetas capturadoras PCIe o dispositivos emulados.
* **ALSA**:
  - Detección: Existencia de `/proc/asound/cards` o del directorio `/dev/snd`.
  - Propósito: Captura y reproducción de audio analógico y digital.
* **Blackmagic DeckLink**:
  - Detección: Existencia del nodo de dispositivo `/dev/blackmagic` o `/dev/bm0`.
  - Propósito: Tarjetas de captura/playout SDI/HDMI profesionales de Blackmagic Design.

#### Formato de la Respuesta (`GET /system/capabilities`):
```json
{
  "vaapi": { "available": true, "details": "Nodos de renderizado encontrados en /dev/dri" },
  "nvenc": { "available": false, "details": "Controlador nvidia-smi no encontrado" },
  "v4l2": { "available": true, "devices": ["/dev/video0"] },
  "alsa": { "available": true, "details": "Tarjetas de sonido de ALSA detectadas" },
  "decklink": { "available": false, "details": "Dispositivo /dev/blackmagic no detectado" }
}
```

## 3. Cambios en el Frontend (UI/UX)

### 3.1 Sidebar (`Sidebar.tsx`)
Se modifica el menú de navegación para añadir la nueva pestaña "Services" y remover el botón de ajustes redundante en la base.
* **Items del Menú**:
  - Dashboard (`dashboard`) - Icono `🏠`
  - Services (`services`) - Icono `⚡`
  - Batch Jobs (`batch`) - Icono `📅`
  - Settings (`settings`) - Icono `⚙️`
  - Tools (`tools`) - Icono `🛠️`
* **Limpieza**: Se elimina el div de la base (`mt-auto`) que renderizaba el botón flotante redundante de la rueda dentada.

### 3.2 Vista del Dashboard (`activeView === 'dashboard'`)
Se reestructura el Dashboard para presentar únicamente información agregada y telemetría de monitoreo del nodo:
* **Grid responsivo de 3 columnas**:
  1. **Carga del Sistema y Datos del Nodo**:
     - Gráficos/Barras de progreso de carga total de CPU (%) y Memoria RAM (Usada / Total).
     - Caja informativa de sistema: Arquitectura (ej: `x86_64 Linux`), conteo de perfiles compilados y versión del backend.
  2. **Contadores de Procesos e Hilos**:
     - Tarjeta con estadísticas de Servicios: Total de servicios configurados y número de servicios activos/corriendo.
     - Tarjeta con estadísticas de Trabajos (Batch Jobs): Total de trabajos registrados e hilos activos.
     - Tarjeta con información del Programador (Scheduler): Estado "Sin programador activo" (Badge de advertencia y descripción informativa).
  3. **Presencia de Soporte/Dispositivos de Hardware**:
     - Visualización en tiempo real del estado de los 5 adaptadores de hardware (VAAPI, NVENC, V4L2, ALSA, DeckLink) consumidos de `/system/capabilities`.
     - Indicadores visuales de colores (Verde/Gris/Rojo) con descripciones textuales.

### 3.3 Vista de Servicios (`activeView === 'services'`)
Se extrae la gestión de servicios a esta nueva pestaña dedicada con estructura de cabecera fija, análoga a la de Batch Jobs:
* **Cabecera Homogénea**:
  - Título principal: "SERVICES"
  - Descripción de uso: "Continuous media streaming and processing node instances"
  - Botones alineados arriba a la derecha: `+ NEW SERVICE` e `IMPORT PROFILE`.
* **Cuerpo Principal**:
  - Listado de servicios activos en ejecución.
  - Listado de servicios configurados (inactivos).
  - Controles individuales de inicio/parada, clonación, edición y borrado.

### 3.4 Vista de Ajustes (`activeView === 'settings'`)
* Se elimina por completo el panel inferior de "System Info" para mantener la pestaña exclusivamente enfocada en configuraciones mutables (nombre del nodo, logotipo personalizado y credenciales de acceso).

## 4. Criterios de Aceptación y Verificación

### 4.1 Backend
* El endpoint `/system/capabilities` debe responder con código `200` y retornar un payload JSON válido con la estructura acordada.
* Los tests del backend no deben verse afectados.

### 4.2 Frontend
* No deben aparecer errores de consola relacionados con cambios en el Sidebar.
* La navegación a través del Sidebar debe activar las vistas correctas.
* Al redimensionar la ventana del navegador, el layout del Dashboard debe responder dinámicamente (modo de 1 columna en móviles, 3 columnas en pantallas grandes).
* Los listados de Servicios y Batch Jobs deben mostrar sus cabeceras homogéneas con botones de control correctamente alineados.
