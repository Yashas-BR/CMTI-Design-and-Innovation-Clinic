# Getting Started - Smart Waste Dashboard API Backend

## 🎯 What Was Created

A production-ready FastAPI backend with:

- ✅ Modular folder structure
- ✅ PostgreSQL with async SQLAlchemy ORM
- ✅ CORS pre-configured for Vite React frontend
- ✅ JWT authentication utilities
- ✅ Database migrations with Alembic
- ✅ Example models and schemas
- ✅ Health check endpoints
- ✅ Testing setup with pytest
- ✅ Docker Compose for PostgreSQL

## 🚀 Start Here (2 Options)

### Option A: Using Docker (Recommended for PostgreSQL)

1. **Start PostgreSQL with Docker Compose:**

   ```bash
   cd backend
   docker-compose up -d
   ```

   This starts:
   - PostgreSQL at `localhost:5432`
   - pgAdmin at `http://localhost:5050`

2. **Activate virtual environment:**

   ```bash
   # Windows
   .venv\Scripts\Activate.ps1

   # macOS/Linux
   source .venv/bin/activate
   ```

3. **Set environment variables:**

   ```bash
   cp .env.example .env
   # Update DATABASE_URL to:
   # DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/smart_waste_db
   ```

4. **Start the API:**
   ```bash
   fastapi dev app/main.py
   ```

### Option B: Using Local PostgreSQL

1. **Create database:**

   ```bash
   createdb smart_waste_db
   # or use psql:
   psql -U postgres -c "CREATE DATABASE smart_waste_db;"
   ```

2. **Setup virtual environment:**

   ```bash
   uv venv --python 3.10
   .venv\Scripts\Activate.ps1  # Windows
   source .venv/bin/activate  # Unix
   uv sync
   ```

3. **Configure .env:**

   ```bash
   cp .env.example .env
   # Edit with your PostgreSQL credentials
   ```

4. **Start API:**
   ```bash
   fastapi dev app/main.py
   ```

## 📚 Access Points

Once running, open your browser:

| URL                                 | Purpose                        |
| ----------------------------------- | ------------------------------ |
| http://localhost:8000               | API Root                       |
| http://localhost:8000/docs          | Interactive API Docs (Swagger) |
| http://localhost:8000/redoc         | ReDoc Documentation            |
| http://localhost:8000/api/v1/health | Health Check                   |
| http://localhost:5050               | pgAdmin (if using Docker)      |

## 📁 File Reference

### Configuration Files

- **pyproject.toml** - Project dependencies and metadata
- **requirements.txt** - Alternative requirements for pip
- **.env.example** - Environment template
- **docker-compose.yml** - PostgreSQL + pgAdmin setup

### Entry Point

- **app/main.py** - FastAPI application with CORS

### Core Modules

- **app/core/config.py** - Load settings from environment
- **app/core/security.py** - JWT, password hashing utilities

### Database

- **app/db/database.py** - AsyncSQLAlchemy engine & sessions
- **app/models/** - Your database models
  - `base.py` - Base classes for all models
  - `waste_bin.py` - Example model

### API Routes

- **app/api/v1/** - Version 1 API endpoints
  - `__init__.py` - Router setup
  - `health.py` - Health check endpoints (example)

### Validation

- **app/schemas/** - Pydantic request/response models
  - `health.py` - Health check schemas (example)

### Database Migrations

- **alembic/** - Database migration system
  - `env.py` - Migration configuration
  - `versions/` - Migration files (auto-generated)

### Testing

- **tests/conftest.py** - Pytest configuration & fixtures

## 🔧 Common Tasks

### Add a New API Endpoint

1. **Create schema** in `app/schemas/your_feature.py`:

   ```python
   from pydantic import BaseModel

   class YourSchema(BaseModel):
       field1: str
       field2: int
   ```

2. **Create route** in `app/api/v1/your_route.py`:

   ```python
   from fastapi import APIRouter
   from app.schemas.your_feature import YourSchema

   router = APIRouter(prefix="/your-feature")

   @router.post("/", response_model=YourSchema)
   async def create_item(item: YourSchema):
       return item
   ```

3. **Include router** in `app/api/v1/__init__.py`:
   ```python
   from .your_route import router as your_router
   router.include_router(your_router, tags=["your-feature"])
   ```

### Add a Database Model

1. **Create model** in `app/models/your_model.py`:

   ```python
   from sqlalchemy import String
   from sqlalchemy.orm import Mapped, mapped_column
   from app.models.base import Base, TimestampMixin

   class YourModel(Base, TimestampMixin):
       __tablename__ = "your_models"
       id: Mapped[int] = mapped_column(primary_key=True)
       name: Mapped[str] = mapped_column(String(100))
   ```

2. **Export in** `app/models/__init__.py`:

   ```python
   from .your_model import YourModel
   __all__ = [..., "YourModel"]
   ```

3. **Generate migration**:
   ```bash
   alembic revision --autogenerate -m "Add YourModel"
   alembic upgrade head
   ```

### Run Tests

```bash
# All tests
pytest

# Verbose
pytest -v

# With coverage
pytest --cov=app

# Specific file
pytest tests/conftest.py::test_health_check
```

### Database Migrations

```bash
# Create migration for model changes
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View history
alembic history
```

## 🔐 Security Checklist

- [ ] Copy `.env.example` to `.env`
- [ ] Change database password
- [ ] Change `SECRET_KEY` in `.env`
- [ ] Add `.env` to `.gitignore` (already done)
- [ ] Update `CORS_ORIGINS` for your domains
- [ ] Enable HTTPS in production
- [ ] Use strong passwords for database

## 🔄 Frontend Integration

Your Vite React frontend connects to:

```javascript
// Frontend API URL
const API_URL = "http://localhost:8000/api/v1";

// Example fetch
const response = await fetch(`${API_URL}/health`);
```

CORS is pre-configured. To add more origins:

**In .env:**

```env
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]
```

## 📖 Documentation Files

Read in order:

1. **SETUP.md** - Detailed setup instructions
2. **README.md** - Complete feature documentation
3. **STRUCTURE.md** - Project structure reference

## 🐛 Troubleshooting

### Database won't connect

```bash
# Check PostgreSQL is running
# For Docker: docker ps
# Check DATABASE_URL format in .env
# Try: postgresql+asyncpg://user:password@host:port/dbname
```

### Module import errors

```bash
# Ensure virtual environment is activated
# Run: uv sync
# Restart your IDE
```

### Port 8000 already in use

```bash
# Use different port
fastapi dev app/main.py --port 8001
```

### Tests fail

```bash
# Ensure test dependencies installed
uv sync

# Check pytest can find modules
# Run from backend directory
pytest -v
```

## ✨ Next Steps

1. ✅ Read **SETUP.md** for detailed setup
2. ✅ Start PostgreSQL (Docker or local)
3. ✅ Activate virtual environment
4. ✅ Run `fastapi dev app/main.py`
5. ✅ Visit http://localhost:8000/docs
6. ✅ Create your first model and endpoint
7. ✅ Connect your React frontend

## 📞 Support Resources

- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **SQLAlchemy Async**: https://docs.sqlalchemy.org/
- **PostgreSQL**: https://www.postgresql.org/docs/
- **uv Package Manager**: https://docs.astral.sh/uv/
- **Alembic**: https://alembic.sqlalchemy.org/

---

**Happy coding! 🚀**
