---
problem: "Windows does not make it easy to see which program is talking to which server, or whether an app that just used your microphone sent anything out afterwards. Most tools either show raw connection tables with no context or label every unfamiliar IP as a threat. NetSentinel shows the facts, explains every flag, and says what it can't see."
platform: "Windows 11 (Windows 10 1903+) · Python 3.12+ or a portable .exe"
---

## What it does

NetSentinel is a desktop monitor for your own Windows PC. It runs locally, needs no account or cloud service, and shows:

- **Every live connection**: the responsible process, its executable path, publisher and code-signing status, parent process, destination, port, protocol and state
- **Microphone and camera activity**: which app is using the device right now, and when each app last started and stopped using it
- **Privacy correlations**: when an app uses the microphone or camera and then opens an outbound connection shortly afterwards, with the destination, the timing and, when measured, the bytes uploaded in that window
- **DNS and destinations**: domain-to-IP mapping, reverse DNS, first-seen tracking, and heuristics for DNS tunnelling and algorithmically generated domains
- **Traffic analysis**: upload and download per application, destination and protocol, unusual upload spikes, periodic "beacon-like" reconnects and long-lived connections
- **A searchable history** in a local SQLite database, with CSV and JSON reports

## Explainable risk, not alarm bells

Each finding carries a score built from named factors, such as an unsigned executable talking to the internet, a program running from a temporary folder, an uncommon port or a regular reconnect interval. Every alert answers five questions: what was detected, why it was flagged, the supporting evidence, what remains uncertain, and what to check next.

A few rules keep the results honest:

- A public IP address is never suspicious on its own, and an unsigned program is only a small factor.
- Heuristic findings are capped at **High**. **Critical** needs a verified match from a threat-intelligence provider or your own blocklist.
- A microphone/camera correlation alert always says that timing is **not proof** that audio or video was sent. Encrypted traffic is never decrypted or inspected.
- Byte counts appear only when they were actually measured. Otherwise the app says "not measured" and explains why.

## Honest about Windows' limits

The privacy monitor reads the same Windows store that drives the microphone and camera indicator. It never opens a device or records anything. The app separates current access, recent access, permission settings and history, and lists its blind spots in the interface: hardware used directly by drivers, the individual website inside a browser, and sessions from before NetSentinel was running.

Some features need Administrator rights, and the app asks only when you choose them: per-connection TCP byte counters, packet-header capture, reading the DNS Client event log, and reversible firewall blocks. Each block shows its consequences, asks for confirmation, and can be removed again from Settings.

## Private by design

Nothing leaves the computer unless you allow it. Threat-intelligence lookups (VirusTotal, AbuseIPDB, AlienVault OTX) are optional and send only the IP address or domain, never logs, files or payloads. Private and local addresses are never sent. API keys are encrypted with Windows DPAPI. The database stores metadata only: no payloads, audio, video, passwords or cookies.

## How it is built

NetSentinel is written in Python with a CustomTkinter interface. Background workers do the monitoring and the interface reads thread-safe snapshots, so the window stays responsive and monitoring continues whichever page is open.

```text
core/network_monitor.py     connection diffing via psutil (GetExtendedTcpTable/UdpTable)
core/process_monitor.py     identity, parent, Authenticode/catalog signature checks
core/privacy_monitor.py     CapabilityAccessManager ConsentStore (mic & camera)
core/correlation_engine.py  device access ↔ outbound connection windows
core/traffic_analyzer.py    TCP EStats byte counters, spikes, beaconing
core/dns_monitor.py         DNS Client log, DNS cache, tunnelling heuristics
core/risk_engine.py         explainable factors → score → severity
database/                   SQLite (WAL, single writer, migrations, retention)
```

Windows APIs are reached through `ctypes`, `winreg` and built-in tools (`wevtutil`, `netsh`, PowerShell). It needs no pywin32 and no drivers beyond the optional Npcap. Missing Python packages are installed automatically on first run, and the test suite covers the engines with simulated events and controlled local connections, never real malware. A PyInstaller build produces a single portable `NetSentinel.exe`.
