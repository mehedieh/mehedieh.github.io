---
problem: "Windows will tell you that something is using the network, but not which program, where it is talking to, whether the microphone or camera was on at the same time, or why any of it should worry you. NetSentinel answers those questions on your own PC, and it shows its evidence instead of just raising alarms."
platform: "Windows 11 (Windows 10 1903+ also works) · Python 3.12 / 3.13"
---

## What it does

NetSentinel is a defensive desktop app for Windows. It watches your own computer and shows you:

- **Which programs are connecting where**: every TCP and UDP connection, with the process responsible, its file path and whether its code signature is valid
- **When the microphone or camera was in use**, and which app was using it
- **Why something was flagged**: each alert comes with the evidence behind it and an honest note on what that evidence cannot prove

## Key features

- **Live connections** through `psutil`, with code-signature checks via `Get-AuthenticodeSignature` and `WinVerifyTrust`
- **Per-connection traffic**: TCP byte counts through Windows' extended statistics (EStats) when run as administrator
- **Microphone and camera history** from the Windows capability-access store, so you can see which apps used them and when
- **DNS visibility** from the DNS-Client event log and the DNS cache, so connections can be matched to the names that were looked up
- **Detection heuristics**: sudden traffic spikes (EWMA baselines), beaconing (connections at suspiciously regular intervals) and signs of DNS tunnelling or algorithm-generated domains
- **Optional threat intelligence**: VirusTotal, AbuseIPDB and AlienVault OTX lookups, used only if you turn them on and add your own keys
- **Context for addresses**: RDAP ownership lookups and offline GeoIP through a local MaxMind database
- **Reversible blocking**: block a program or address with a Windows Firewall rule, and remove it again with one click
- **Reports**: export to CSV or JSON, or run headless from the command line, for example `--headless -d 60 --report full --format json`

## An honest risk engine

Security tools lose trust when they cry wolf. NetSentinel's risk engine is built to be explainable:

- Every risk score lists the reasons that produced it
- Heuristics alone are capped at **High**. A **Critical** rating needs a verified match from threat intelligence or a blocklist
- When a connection happens while the microphone or camera is in use, the alert says so, and also says plainly that the timing is **not proof** of spying

## What it will never do

NetSentinel is a monitor you can trust because of its limits. It never hides itself, never opens your microphone or camera, never records the content of your traffic, never decrypts TLS, never disables Microsoft Defender or the Windows Firewall, and never sends data anywhere without your explicit permission.

## How it is built

- **Python** with **CustomTkinter** for a ten-page desktop interface, and **matplotlib** for charts
- Windows is reached directly through `ctypes` and `winreg`, plus PowerShell, `wevtutil` and `netsh`; packet capture with **scapy** and **Npcap** is optional
- History is kept in **SQLite** in WAL mode, and API keys are encrypted with Windows **DPAPI**, so they are tied to your user account
- **47 pytest tests** cover unit, integration and GUI smoke checks
- It can be packaged as a **portable .exe** that runs without administrator rights; some features, such as per-connection byte counts, need them

## Getting started

Clone the repository, then run `setup.ps1` once and start the app with `run.ps1` (add `-Admin` for the features that need administrator rights). Double-click `.bat` launchers are included too. The [README on GitHub](https://github.com/mehedieh/NetSentinel) has the full instructions.

## Use it responsibly

Use NetSentinel only on computers you own or are authorised to monitor. It helps you understand what your PC is doing; it is not an antivirus and does not replace one.
