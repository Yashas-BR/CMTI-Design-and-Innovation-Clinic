# Smart Waste Dashboard API

A modern FastAPI backend for the Smart Waste Management System.

## Features

- 🚀 **FastAPI** 0.135.0 - High-performance web framework
- 🗄️ **PostgreSQL** - Robust relational database
- 🔄 **SQLAlchemy 2.1** - Async ORM with modern patterns
- 📦 **uv** - Lightning-fast Python package manager
- 🛡️ **CORS** - Pre-configured for Vite React frontend
- 🔑 **JWT Authentication** - Security utilities included
- 📝 **Pydantic 2** - Data validation and serialization
- 🧪 **pytest** - Testing framework

## Project Structure

```
backend/
├── app/
│   ├── api/              # API routes (v1, v2, etc.)
│   │   └── v1/
│   │       ├── health.py # Health check endpoints
│   │       └── __init__.py
│   ├── core/             # Core configuration
│   │   ├── config.py     # Settings from environment
│   │   ├── security.py   # JWT and password utilities
│   │   └── __init__.py
│   ├── db/               # Database configuration
│   │   ├── database.py   # Database engine and sessions
│   │   └── __init__.py
│   ├── models/           # SQLAlchemy models
│   │   ├── base.py       # Base model classes
│   │   └── __init__.py
│   ├── schemas/          # Pydantic schemas
│   │   ├── health.py     # Health check schemas
│   │   └── __init__.py
│   ├── main.py           # Application factory
│   └── __init__.py
├── alembic/              # Database migrations
├── tests/                # Test suite
├── .env.example          # Environment template
├── .gitignore
├── pyproject.toml        # Project metadata and dependencies
└── README.md
```

## Quick Start

### Prerequisites

- Python 3.10+
- PostgreSQL 13+
- uv package manager

### Installation

1. **Install uv** (if not already installed):

   ```bash
   # Windows (PowerShell)
   powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

   # macOS/Linux
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Navigate to backend directory**:

   ```bash
   cd backend
   ```

3. **Create virtual environment with Python 3.10**:

   ```bash
   uv venv --python 3.10
   ```

4. **Activate virtual environment**:

   ```bash
   # Windows
   .venv\Scripts\activate

   # macOS/Linux
   source .venv/bin/activate
   ```

5. **Install dependencies**:

   ```bash
   uv sync
   ```

6. **Setup environment variables**:

   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

7. **Run migrations** (when alembic is setup):

   ```bash
   alembic upgrade head
   ```

8. **Start development server**:

   ```bash
   # Using fastapi CLI (recommended)
   fastapi dev app/main.py

   # Or using uvicorn
   uvicorn app.main:app --reload
   ```

The API will be available at `http://localhost:8000`

## API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/openapi.json

## Environment Variables

See `.env.example` for all available configuration options:

```env
DEBUG=True
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/smart_waste_db
CORS_ORIGINS=["http://localhost:5173"]
```

## Database

### PostgreSQL Setup

```bash
# Create database
createdb smart_waste_db

# Or using psql
psql -U postgres -c "CREATE DATABASE smart_waste_db;"
```

### Async with asyncpg

The application uses SQLAlchemy with asyncpg for high-performance async PostgreSQL operations:

```python
# Database connection is configured in app/db/database.py
DATABASE_URL = "postgresql+asyncpg://user:password@localhost:5432/smart_waste_db"
```

## CORS Configuration

CORS is pre-configured to work with your Vite React frontend:

```python
# From app/core/config.py
cors_origins = [
    "http://localhost:5173",      # Vite dev server
    "http://127.0.0.1:5173",
    "http://localhost:3000",       # Alternative port
]
```

To allow additional origins, update the `CORS_ORIGINS` environment variable.

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app

# Run specific test file
pytest tests/test_health.py
```

### Code Quality

```bash
# Format code
black app tests

# Lint code
ruff check app tests

# Type checking
mypy app
```

### Dependencies Management

Using `uv`:

```bash
# Add a new dependency
uv add fastapi-sqlmodel

# Add a dev dependency
uv add --dev pytest-cov

# Update dependencies
uv sync

# View dependency tree
uv pip show --all
```

## Production Deployment

### Using Gunicorn with Uvicorn Workers

```bash
pip install gunicorn
gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### Docker

```dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy project files
COPY pyproject.toml .
RUN uv sync --frozen

# Copy application
COPY app app

# Run application
CMD ["uv", "run", "app/main.py"]
```

## Security Considerations

1. **Never commit `.env` file** - Use `.env.example` as template
2. **Change `SECRET_KEY`** in production
3. **Enable HTTPS** in production
4. **Use environment-specific configurations**
5. **Validate and sanitize user inputs**
6. **Use strong database passwords**

## Troubleshooting

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -U username -h localhost -d smart_waste_db

# Check DATABASE_URL format
# postgresql+asyncpg://user:password@host:port/database
```

### Virtual Environment Issues

```bash
# Recreate virtual environment
rm -rf .venv
uv venv --python 3.10
uv sync
```

### Import Errors

```bash
# Ensure backend directory is in PYTHONPATH
# Or run from backend directory
cd backend
```

## Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and commit: `git commit -am 'Add feature'`
3. Push to branch: `git push origin feature/your-feature`
4. Submit pull request

## License

This project is part of CMTI Design and Innovation Clinic.

## Support

For issues and questions, please contact the development team.
