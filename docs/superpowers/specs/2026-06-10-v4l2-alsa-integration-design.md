# Design Specification: V4L2 & ALSA Integration

**Goal**: Implement comprehensive auto-discovery and configuration interfaces for Video4Linux2 (V4L2) video capture devices (including Magewell Pro Capture cards) and ALSA audio devices (handling subdevice multi-channel configurations like AudioScience ASI cards).

## Architectural Design

### 1. Backend API Endpoints

#### `GET /v4l2/devices`
- **Logic**:
  1. Check if Magewell tools (`mwcap-info` or `mweco-info`) are installed.
  2. If found, run `mwcap-info -l` to get the list of Magewell devices (including device path, name, firmware/driver version, and ALSA input mapping).
  3. Parse the output. For example:
     ```text
     /dev/video0     1.34            B               1.3.4429        hw:1,0          00:00 Pro Capture SDI
     ```
  4. Query general system V4L2 devices using `v4l2-ctl --list-devices` or reading `/sys/class/video4linux/video*/name`.
  5. Deduplicate and merge both sources by matching device path (`/dev/video*`).
- **Response Format**:
  ```json
  [
    {
      "device": "/dev/video0",
      "name": "00:00 Pro Capture SDI",
      "alsa_device": "hw:1,0",
      "is_magewell": true
    }
  ]
  ```

#### `GET /v4l2/formats`
- **Parameters**: `device` (query parameter, e.g. `/dev/video0`)
- **Logic**:
  1. Call `ffmpeg -f v4l2 -list_formats all -i <device>` using the resolved local dynamic FFmpeg binary path.
  2. Parse the stderr stream using regular expressions to extract format classifications, pixel formats, and resolution sets.
- **Response Format**:
  ```json
  [
    {
      "type": "Raw",
      "pixel_format": "yuyv422",
      "description": "YUV 4:2:2 (YUYV)",
      "resolutions": ["640x480", "320x240"]
    }
  ]
  ```

#### `GET /alsa/devices`
- **Logic**:
  1. Run the system ALSA utility `arecord -l`.
  2. Parse each matched card/device line.
  3. Detect subdevices block (e.g. `Subdevice #0`, `Subdevice #1`). If there are multiple subdevices under a device, generate individual listings for each subdevice (using `hw:CARD,DEV,SUBDEV`). If there is only one subdevice, use the shorter standard form `hw:CARD,DEV`.
- **Response Format**:
  ```json
  [
    {
      "device": "hw:0,0",
      "name": "HDA Intel PCH (ALC892 Analog)"
    },
    {
      "device": "hw:1,0",
      "name": "00 Pro Capture SDI (Pro Capture PCM)"
    },
    {
      "device": "hw:0,0,0",
      "name": "ASI58100 [ASI5810-0] - Asihpi PCM (Subdevice #0)"
    }
  ]
  ```

### 2. Frontend Components

#### Video4Linux2 (`v4l2`) Configuration
- Dropdown select for V4L2 devices queried from `/v4l2/devices`.
- Manual input toggle fallback for custom paths.
- Dynamic format and resolution query on device select, rendering standard select inputs.
- Sincronización de Audio SDI for Magewell cards:
  - If a selected V4L2 device contains an associated `alsa_device` field, render a banner offering a quick action: `[ Sincronizar Entrada de Audio SDI ]`.
  - Clicking this action automatically configures the task's secondary audio source to use `alsa` pointing to the associated device identifier.

#### ALSA Audio (`alsa`) Configuration
- Dropdown select for ALSA audio sources queried from `/alsa/devices`, rendering human-friendly labels: `Device Name [alsa_identifier]`.
- Manual input toggle fallback.
