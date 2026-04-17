# Quick Setup Script for FastAPI Backend (Windows PowerShell)

Write-Host "🚀 Smart Waste Dashboard API - Setup Script"
Write-Host "========================================" -ForegroundColor Cyan

# Check Python version
Write-Host "✓ Checking Python version..."
python --version

# Create virtual environment
Write-Host "✓ Creating virtual environment with Python 3.10..."
uv venv --python 3.10

Write-Host ""
Write-Host "⚠️  Please run this in PowerShell to activate:" -ForegroundColor Yellow
Write-Host "   .venv\Scripts\Activate.ps1"
Write-Host ""

# Install dependencies
Write-Host "✓ Installing dependencies with uv..."
uv sync

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Activate the virtual environment: .venv\Scripts\Activate.ps1"
Write-Host "2. Create .env file from .env.example"
Write-Host "3. Set up PostgreSQL database"
Write-Host "4. Run: fastapi dev app/main.py"
Write-Host ""
Write-Host "API will be available at http://localhost:8000"
Write-Host "Docs at http://localhost:8000/docs"
