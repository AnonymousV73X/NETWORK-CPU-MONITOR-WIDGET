@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js not found. Get it from https://nodejs.org && pause && exit /b)
if not exist node_modules (
    echo Installing dependencies...
    npm install
)
npm start
