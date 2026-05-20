# Especificación de Diseño: Optimización de UI y Flujo de Control en FFMPEG Service Panel

Este documento detalla los cambios para optimizar la interfaz de control de procesos FFMPEG, resolviendo problemas de desbordamiento vertical, ocultando inteligentemente la preview de video en streams sin video o inactivos, y mejorando la usabilidad y navegación general del modal.

---

## 1. Problemas a Resolver
1. **Desbordamiento de Controles:** El modal actual (`Preview Modal`) excede la altura de la pantalla en la mayoría de resoluciones debido a un diseño puramente vertical con contenedores de gran tamaño (aspect-video para preview, logs de 256px, cabecera y estadísticas).
2. **Preview Innecesaria:** Cuando el proceso no está corriendo o es un stream de audio puro (ej. MP3 a Icecast2), el contenedor de la preview de video (MJPEG) queda vacío, ocupa espacio crítico y da una mala sensación visual.
3. **Pérdida de Flujo de Control:** Si el modal desborda la pantalla, los botones de interacción y el botón de cerrar (`✕`) quedan fuera de vista. Además, no es posible cerrar el modal haciendo clic en el fondo ni pulsando `Escape`.

---

## 2. Arquitectura de Solución y Flujo

```mermaid
graph TD
    A[WebSocket Telemetry] -->|input_config & status| B(React App)
    B --> C{¿Running y has_video?}
    C -->|Sí| D[Mostrar Preview + Stats/Logs en 2 Columnas]
    C -->|No| E[Ocultar Preview + Stats/Logs en 1 Columna]
    B --> F[Modales con max-h-[90vh] e Internal Scroll]
    B --> G[Listeners: Backdrop Click & Escape Key]
```

### A. Telemetría Enriquecida (Backend)
- Modificar el bucle de difusión en tiempo real en `/ws/telemetry` para incluir:
  - `input_config`: Permite al frontend determinar si el stream posee video (`input_config.has_video`).
  - `codec_config`: Proporciona detalles adicionales de los códecs configurados.

### B. UI Adaptable y Eficiente (Frontend)
- **Live Updating:** Obtener las estadísticas en tiempo real vinculando `selectedProcess` con la telemetría dinámica:
  ```typescript
  const currentProcess = telemetry.find(p => p.id === selectedProcess.id) || selectedProcess;
  ```
- **Diseño del Modal de Control:**
  - Cambiar su clase contenedora a `max-h-[90vh] flex flex-col overflow-hidden`.
  - Distribuir el espacio de la siguiente forma:
    - **Cabecera (Fija):** Título del servicio y subtítulo.
    - **Cuerpo (Desplazable / Scrollable):**
      - Si `currentProcess.status === 'running' && currentProcess.input_config?.has_video !== false`:
        - Usar un diseño de dos columnas (`grid grid-cols-1 lg:grid-cols-2 gap-6`).
        - Columna Izquierda: Estadísticas en vivo y controles.
        - Columna Derecha: Contenedor de preview de video.
      - En caso contrario:
        - Diseño de una sola columna. El contenedor de preview de video se oculta del DOM por completo.
      - **Logs del Proceso (Fijo en el footer o bajo el cuerpo scrollable):** Un contenedor de terminal con altura máxima de `200px` (u adaptable) y `overflow-y-auto`.
    - **Pie de Página (Fijo):** Botones de acción y un nuevo botón "Cerrar" explícito.

### C. Navegación Resiliente
- **Cierre por Backdrop:** Añadir un manejador de clics en el fondo oscuro del modal.
- **Teclado:** Listener global en el hook del modal para escuchar la tecla `Escape`.

---

## 3. Cambios Propuestos por Archivo

### `backend/main.py`
En `telemetry_broadcast_loop`:
```python
# Añadir a la serialización del proceso
"input_config": p.input_config,
"codec_config": p.codec_config,
```

### `frontend/src/App.tsx`
- Implementar la lógica para mapear `selectedProcess` al estado actualizado de `telemetry`.
- Agregar el listener para la tecla `Escape` mediante un `useEffect`:
  ```typescript
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProcess(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProcess]);
  ```
- Reestructurar el JSX del Modal de Preview para soportar el comportamiento dinámico de la columna de preview, limitar la altura del modal a `max-h-[90vh]` con estructura flexbox (Header, Body con scroll, Footer fijo), y habilitar clics de cierre en el backdrop.

### `docs/FFMPEG_FORGE_ROADMAP.md`
- Añadir un apartado en el roadmap sobre el diseño e implementación futura de un sistema de doble vúmetro escala verde-roja en la interfaz para monitorizar audio a nivel de broadcast.

---

## 4. Plan de Verificación

1. **Prueba de Servicio Detenido:**
   - Abrir el panel de control de un servicio detenido.
   - Verificar que no se muestre ningún recuadro de preview (ni imagen rota) y que los controles/logs ocupen todo el ancho del modal de forma limpia.
2. **Prueba de Servicio de Audio Puro (MP3/Icecast):**
   - Iniciar un servicio configurado con `Video: false`.
   - Abrir su panel de control mientras está en ejecución (`running`).
   - Verificar que el panel de preview no aparezca en pantalla y que la interfaz permanezca expandida a una columna y libre de desbordamientos.
3. **Prueba de Servicio de Video (H264/SRT):**
   - Iniciar un servicio configurado con `Video: true`.
   - Abrir su panel de control en ejecución.
   - Verificar que se muestre el grid de dos columnas (controles/stats a la izquierda, preview a la derecha) de manera compacta sin desbordar los límites verticales de la pantalla.
4. **Prueba de Resiliencia y Cierre:**
   - Confirmar que el modal se cierra al presionar la tecla `Escape`.
   - Confirmar que el modal se cierra al hacer clic en el backdrop oscuro.
   - Confirmar que el botón "Cerrar" en el footer funciona correctamente.
