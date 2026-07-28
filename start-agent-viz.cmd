@echo off
rem Starts the Agent Viz dashboard server, logging to server.log (fresh each run).
rem Launched hidden at Windows logon by agent-viz.vbs in the Startup folder.
cd /d "%~dp0"
node server.js > server.log 2>&1
