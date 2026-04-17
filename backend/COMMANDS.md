# 🚀 Next Steps - Execute These Commands

## ✅ Verification

First, verify everything was created correctly:

```bash
# Navigate to backend folder
cd backend

# List all files
dir /s    # Windows
ls -la    # macOS/Linux
```

You should see folders: `app/`, `alembic/`, `tests/` and files like `pyproject.toml`, `README.md`, etc.

---

## 📦 Step 1: Create Virtual Environment (One-time)

### Windows (PowerShell as Administrator)

```powershell
# Navigate to backend
cd backend

# Create virtual environment with Python 3.10
uv venv --python 3.10

# Activate (run this every time you start development)
.venv\Scripts\Activate.ps1

# If you get permission denied error:
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### macOS/Linux

```bash
# Navigate to backend
cd backend

# Create virtual environment
uv venv --python 3.10

# Activate
source .venv/bin/activate
```

---

## 📥 Step 2: Install Dependencies

(Only if venv is activated)

```bash
uv sync
```

This installs all dependencies from `pyproject.toml`.

---

## 🗄️ Step 3: Setup PostgreSQL Database

### Option A: Using Docker (Recommended) ⭐

```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Verify it's running
docker ps

# Access pgAdmin at http://localhost:5050
# Default: admin@admin.com / admin
```

### Option B: Using Local PostgreSQL

```bash
# Create database
createdb smart_waste_db

# Or using psql
psql -U postgres -c "CREATE DATABASE smart_waste_db;"
```

---

## 🔒 Step 4: Configure Environment Variables

```bash
# Copy environment template
cp .env.example .env

# Windows: copy .env.example .env
```

Edit `.env` file with your settings:

```env
# If using Docker Compose:
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/smart_waste_db

# If using local PostgreSQL:
DATABASE_URL=postgresql+asyncpg://postgres:YOUR_PASSWORD@localhost:5432/smart_waste_db

# Frontend
CORS_ORIGINS=["http://localhost:5173"]

# Security (Change in production!)
SECRET_KEY=your-secret-key-change-this

# Debug mode
DEBUG=True
```

---

## 🚀 Step 5: Run the API Server

Make sure virtual environment is activated (See Step 1)

### Using FastAPI CLI (Recommended)

```bash
fastapi dev app/main.py
```

### Or Using Uvicorn

```bash
uvicorn app.main:app --reload
```

Expected output:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

---

## 🌐 Step 6: Verify It's Working

Open your browser:

| URL                                 | Expected                     |
| ----------------------------------- | ---------------------------- |
| http://localhost:8000               | Welcome message              |
| http://localhost:8000/docs          | Interactive API (Swagger)    |
| http://localhost:8000/redoc         | API Documentation (ReDoc)    |
| http://localhost:8000/api/v1/health | `{"status": "healthy", ...}` |

---

## 📖 Step 7: Read Documentation

1. **ℹ️ QUICKSTART.md** - Quick reference guide
2. **📚 README.md** - Full documentation
3. **🏗️ STRUCTURE.md** - Project structure
4. **📋 SETUP.md** - Detailed setup guide

---

## 🧪 Step 8: Run Tests (Optional)

```bash
# Make sure virtual environment is activated

# Run all tests
pytest

# Run with details
pytest -v

# Run with coverage
pytest --cov=app
```

---

## 🎯 Step 9: Connect Frontend

Your Vite React frontend can now connect to:

```javascript
// .env or constants file
const API_URL = "http://localhost:8000/api/v1";

// Example
const response = await fetch(`${API_URL}/health`);
const data = await response.json();
console.log(data.status); // "healthy"
```

---

## 📝 Step 10: Add Your First Feature

### Example: Add a User API

1. Create schema in `app/schemas/user.py`:

   ```python
   from pydantic import BaseModel, EmailStr

   class UserCreate(BaseModel):
       email: EmailStr
       name: str

   class UserResponse(UserCreate):
       id: int
   ```

2. Create route in `app/api/v1/users.py`:

   ```python
   from fastapi import APIRouter
   from app.schemas.user import UserCreate, UserResponse

   router = APIRouter(prefix="/users")

   @router.post("/", response_model=UserResponse)
   async def create_user(user: UserCreate):
       return {"id": 1, **user.dict()}
   ```

3. Include in `app/api/v1/__init__.py`:

   ```python
   from .users import router as users_router
   router.include_router(users_router, tags=["users"])
   ```

4. Test at: http://localhost:8000/docs

---

## 🆘 Troubleshooting

### "Module not found" error

```bash
# Ensure virtual environment activated
.venv\Scripts\Activate.ps1  # Windows
source .venv/bin/activate  # Unix

# Reinstall dependencies
uv sync
```

### "Database connection refused"

```bash
# Check PostgreSQL is running
# If using Docker:
docker ps
docker-compose logs postgres

# Check .env DATABASE_URL format
# Should be: postgresql+asyncpg://user:password@localhost:5432/database
```

### "Port 8000 already in use"

```bash
# Use different port
fastapi dev app/main.py --port 8001
```

### Virtual environment issues

```bash
# Recreate it
rm -rf .venv
uv venv --python 3.10
uv sync
```

---

## ✨ You're All Set!

Your FastAPI backend is ready:

- ✅ PostgreSQL configured
- ✅ Models and migrations ready
- ✅ CORS setup for React frontend
- ✅ API documentation available
- ✅ Testing framework ready

---

## 📊 Command Quick Reference

```bash
# Activate environment
.venv\Scripts\Activate.ps1              # Windows
source .venv/bin/activate              # Unix

# Database
docker-compose up -d                    # Start PostgreSQL
alembic upgrade head                    # Apply migrations
alembic revision --autogenerate -m "msg"
.venv\Scripts\python -m app.db.seed_initial_data  # Seed initial required auth data

# Run API
fastapi dev app/main.py
uvicorn app.main:app --reload

# Testing
pytest
pytest -v
pytest --cov=app

# Code Quality
black app tests
ruff check app tests
mypy app

# Dependencies
uv add package_name
uv add --dev package_name
uv sync
```

---

## 🔗 Useful Links

- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **SQLAlchemy Async**: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- **PostgreSQL**: https://www.postgresql.org/docs/
- **uv Package Manager**: https://docs.astral.sh/uv/
- **Alembic Migrations**: https://alembic.sqlalchemy.org/

---

**START HERE:** Run the Step 1-6 commands above and your API will be live! 🚀
