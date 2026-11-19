# Prometheus & Grafana Integration for ffmpeg-gui

`ffmpeg-gui` includes a high-performance OpenMetrics / Prometheus exporter accessible at `/api/metrics`.

All telemetry data is served directly from in-memory ring buffers and kernel / sysfs hardware probes with zero disk I/O, designed for high-frequency scraping intervals (5s - 15s).

---

## 1. Enable the Exporter in ffmpeg-gui

1. Open the **ffmpeg-gui** web interface.
2. Go to **Settings ➔ Network ➔ Prometheus / OpenMetrics Exporter**.
3. Toggle **Enable Metrics Exporter**.
4. Generate or copy your secure **Bearer Token**.
5. Save settings.

---

## 2. Test Scraping with curl

You can verify that the endpoint is operating correctly directly from your terminal:

```bash
curl -s -H "Authorization: Bearer YOUR_SECRET_TOKEN" http://<HOST_IP>:<PORT>/api/metrics
```

---

## 3. Configure Prometheus

Add a scrape job to your `/etc/prometheus/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'ffmpeg-gui'
    scrape_interval: 10s
    scrape_timeout: 5s
    metrics_path: '/api/metrics'
    scheme: 'http'

    # The Bearer Token generated in Settings -> Network
    bearer_token: 'YOUR_SECRET_TOKEN'

    static_configs:
      - targets: ['192.168.1.50:8000']
        labels:
          environment: 'production'
          node_role: 'broadcast-encoder'
          appliance: 'ffmpeg-gui-01'
```

A complete reference configuration is available in [prometheus.yml.example](file:///home/alex/LocalRepositories/ffmpeg-gui/packaging/prometheus/prometheus.yml.example).

Reload Prometheus to apply changes:
```bash
curl -X POST http://localhost:9090/-/reload
```

---

## 4. Import the Grafana Dashboard

A production-ready dashboard is provided in [grafana-dashboard-ffmpeg-gui.json](file:///home/alex/LocalRepositories/ffmpeg-gui/packaging/prometheus/grafana-dashboard-ffmpeg-gui.json).

1. In Grafana, navigate to **Dashboards ➔ New ➔ Import**.
2. Click **Upload dashboard JSON file** and select `packaging/prometheus/grafana-dashboard-ffmpeg-gui.json`.
3. Select your Prometheus datasource when prompted (`DS_PROMETHEUS`).
4. Click **Import**.

### Dashboard Highlights

- **Host & System Health**: Host CPU %, RAM %, hardware temperatures (package, cores, GPU), fan RPM tachometers, thermal throttling alarms, and storage pools.
- **Broadcast Services**: Active vs total services count, background tasks running, process restart counters, individual service CPU % and resident RAM.
- **FFmpeg Stream Performance**: Realtime FPS graphs, live bitrate (kbps), and encoding speed ratio ($1.00\times$ baseline).
- **Subsystems**: Icecast2 listeners and mountpoint bitrates, MediaMTX paths and connected readers, PipeWire sidecars and sinks.
- **Federated Mesh**: Peer online statuses and round-trip ping latencies across federated nodes.
