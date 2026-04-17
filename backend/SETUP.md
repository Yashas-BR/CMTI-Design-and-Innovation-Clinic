# SETUP GUIDE - Smart Waste Dashboard API Backend

## 📋 Prerequisites

- Python 3.10 or higher
- PostgreSQL 13 or higher
- uv package manager (or pip)
- Git (optional)

## ⚡ Quick Start (5 minutes)

### Step 1: Install uv Package Manager

**Windows (PowerShell as Administrator):**

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**macOS/Linux:**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Step 2: Navigate to Backend Directory

```bash
cd backend
```

### Step 3: Create Virtual Environment with Python 3.10

```bash
uv venv --python 3.10
```

### Step 4: Activate Virtual Environment

**Windows (PowerShell):**

```powershell
.venv\Scripts\Activate.ps1
```

**Windows (CMD):**

```cmd
.venv\Scripts\activate.bat
```

**macOS/Linux:**

```bash
source .venv/bin/activate
```

### Step 5: Install Dependencies

```bash
uv sync
```

### Step 6: Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env      # macOS/Linux
# or
copy .env.example .env    # Windows

# Edit .env with your settings
# Most important: DATABASE_URL
```

### Step 7: Create PostgreSQL Database

**Option A - Using psql:**

```bash
psql -U postgres -c "CREATE DATABASE smart_waste_db;"
```

**Option B - Using createdb:**

```bash
createdb -U postgres smart_waste_db
```

**Option C - Using pgAdmin (GUI)**

- Create new database called `smart_waste_db`

### Step 8: Update .env with Database URL

Edit the `.env` file and set:

```env
DATABASE_URL=postgresql+asyncpg://postgres:your_password@localhost:5432/smart_waste_db
DEBUG=True
```

### Step 9: Run the Server

**Using fastapi CLI (recommended):**

```bash
fastapi dev app/main.py
```

**Or using uvicorn:**

```bash
uvicorn app.main:app --reload
```

## ✅ Verify Setup

Visit in your browser:

- API: http://localhost:8000
- Interactive Docs: http://localhost:8000/docs
- ReDoc Docs: http://localhost:8000/redoc
- Health Check: http://localhost:8000/api/v1/health

## 📁 Project Structure

```
backend/
├── app/                      # Main application
│   ├── api/v1/              # API endpoints (v1)
│   │   ├── health.py        # Health check endpoints
│   │   └── __init__.py
│   ├── core/                # Configuration
│   │   ├── config.py        # Settings from .env
│   │   ├── security.py      # JWT, password hashing
│   │   └── __init__.py
│   ├── db/                  # Database
│   │   ├── database.py      # SQLAlchemy setup
│   │   └── __init__.py
│   ├── models/              # Database models
│   │   ├── base.py          # Base classes
│   │   ├── waste_bin.py     # Example: WasteBin model
│   │   └── __init__.py
│   ├── schemas/             # Pydantic validation
│   │   ├── health.py        # Health schemas
│   │   └── __init__.py
│   ├── main.py              # FastAPI app factory
│   └── __init__.py
├── alembic/                 # Database migrations
│   ├── versions/            # Migration files (auto-generated)
│   ├── env.py               # Migration config
│   └── alembic.ini
├── tests/                   # Test suite
│   ├── conftest.py          # Pytest configuration
│   └── __init__.py
├── .env.example             # Environment template
├── .gitignore
├── pyproject.toml           # Project metadata & dependencies
├── requirements.txt         # Alternative pip requirements
├── README.md                # Full documentation
└── setup.ps1 / setup.sh     # Setup scripts

```

## 🗄️ Database Migrations (Using Alembic)

This project now uses a phased schema rollout for Smart Bin operations.

### Migration Files (already created)

- `20260417_01_core_master_data` - organizations, users, roles, bins, devices
- `20260417_02_telemetry_alerts` - MQTT raw data, telemetry history, current state, alerts
- `20260417_03_operations_prediction_audit` - routes, driver ops, prediction, audit logs

### Step-by-Step Apply (Recommended)

1. **Check migration graph first**

   ```bash
   .venv\Scripts\alembic.exe -c alembic\alembic.ini history
   .venv\Scripts\alembic.exe -c alembic\alembic.ini heads
   ```

2. **Apply Phase 1 only**

   ```bash
   .venv\Scripts\alembic.exe -c alembic\alembic.ini upgrade 20260417_01
   ```

3. **Apply Phase 2 only**

   ```bash
   .venv\Scripts\alembic.exe -c alembic\alembic.ini upgrade 20260417_02
   ```

4. **Apply Phase 3 only**

   ```bash
   .venv\Scripts\alembic.exe -c alembic\alembic.ini upgrade 20260417_03
   ```

5. **Confirm final revision**

   ```bash
   .venv\Scripts\alembic.exe -c alembic\alembic.ini current
   ```

### Apply Everything in One Command

```bash
.venv\Scripts\alembic.exe -c alembic\alembic.ini upgrade head
```

### Rollback

```bash
# Roll back one migration step
.venv\Scripts\alembic.exe -c alembic\alembic.ini downgrade -1

# Roll back to base (dangerous in shared DB)
.venv\Scripts\alembic.exe -c alembic\alembic.ini downgrade base
```

## 📦 Managing Dependencies with uv

### Add a Package

```bash
uv add fastapi-sqlmodel
```

### Add a Dev Package

```bash
uv add --dev pytest-cov
```

### Update All Dependencies

```bash
uv sync
```

### View Installed Packages

```bash
uv pip list
```

## 🧪 Running Tests

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/conftest.py

# Run with coverage
pytest --cov=app
```

## 🚀 Starting Development

1. **Terminal 1 - Backend API:**

   ```bash
   cd backend
   .venv\Scripts\Activate.ps1    # Windows
   fastapi dev app/main.py
   ```

2. **Terminal 2 - Frontend (from project root):**
   ```bash
   cd frontend
   npm run dev
   ```

Access:

- Backend API: http://localhost:8000
- Frontend: http://localhost:5173
- API Docs: http://localhost:8000/docs

## 🔧 Troubleshooting

### "PostgreSQL connection refused"

- Ensure PostgreSQL is running
- Check DATABASE_URL in .env
- Verify database exists: `psql -l`

### "ModuleNotFoundError: No module named 'app'"

- Ensure you're in the `backend` directory
- Virtual environment should be activated
- Run `uv sync` again

### "Port 8000 already in use"

```bash
# Run on different port
uvicorn app.main:app --reload --port 8001
```

### "Virtual environment issues"

```bash
# Recreate environment
rm -rf .venv
uv venv --python 3.10
uv sync
```

## 🐍 Python Version Check

Verify Python 3.10+ is available:

```bash
python --version
# or
python3 --version
```

## 📚 Additional Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Async Guide](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [uv Documentation](https://docs.astral.sh/uv/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)

## ✨ Next Steps After Setup

1. **Create API endpoints** in `app/api/v1/`
2. **Add database models** in `app/models/`
3. **Create Pydantic schemas** in `app/schemas/`
4. **Generate migrations**: `alembic revision --autogenerate -m "description"`
5. **Implement business logic** in service layers

## 🎯 CORS Configuration for Frontend

The backend is pre-configured with CORS for your Vite React frontend:

```python
CORS_ORIGINS=["http://localhost:5173", "http://127.0.0.1:5173"]
```

To add more origins, update in `.env`:

```env
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000", "https://yourdomain.com"]
```

## 🔐 Security Reminders

- ⚠️ Never commit `.env` file - use `.env.example` template
- ⚠️ Change `SECRET_KEY` in production
- ⚠️ Use strong database passwords
- ⚠️ Enable HTTPS in production
- ⚠️ Validate all user inputs

---

**Need help?** Check the README.md for detailed documentation.
