#!/bin/bash
# Quick Setup Script for FastAPI Backend

echo "🚀 Smart Waste Dashboard API - Setup Script"
echo "========================================"

# Check Python version
echo "✓ Checking Python version..."
python --version

# Create virtual environment
echo "✓ Creating virtual environment with Python 3.10..."
uv venv --python 3.10

# Activate virtual environment (user needs to do this manually)
echo ""
echo "⚠️  Please activate the virtual environment:"
echo "   Windows: .venv\\Scripts\\activate"
echo "   macOS/Linux: source .venv/bin/activate"
echo ""

# Install dependencies
echo "✓ Installing dependencies with uv..."
uv sync

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Activate the virtual environment"
echo "2. Create .env file from .env.example"
echo "3. Set up PostgreSQL database"
echo "4. Run: fastapi dev app/main.py"
echo ""
echo "API will be available at http://localhost:8000"
echo "Docs at http://localhost:8000/docs"
