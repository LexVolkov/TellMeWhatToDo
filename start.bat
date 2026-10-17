@echo off
cd /d %~dp0
set PORT=9123
start http://localhost:9123
node server.js
