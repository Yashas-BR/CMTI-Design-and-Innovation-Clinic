"""Project structure and file references."""

PROJECT_STRUCTURE = """
Smart Waste Dashboard Backend - Complete Structure
====================================================

backend/
├── app/ # Main application package
│ ├── **init**.py # Package initialization
│ ├── main.py # FastAPI app factory with CORS
│ │
│ ├── api/ # API routes package
│ │ ├── **init**.py
│ │ └── v1/ # API v1 routes
│ │ ├── **init**.py # Router setup
│ │ ├── health.py # Health check endpoints
│ │ └── [add more routes] # Add new endpoints here
│ │
│ ├── core/ # Core configuration
│ │ ├── **init**.py
│ │ ├── config.py # Settings from environment
│ │ └── security.py # JWT & password utilities
│ │
│ ├── db/ # Database configuration
│ │ ├── **init**.py
│ │ └── database.py # SQLAlchemy async engine
│ │
│ ├── models/ # SQLAlchemy ORM models
│ │ ├── **init**.py # Model exports
│ │ ├── base.py # Base classes & mixins
│ │ ├── waste_bin.py # Example: WasteBin model
│ │ └── [add more models] # Add database models
│ │
│ └── schemas/ # Pydantic request/response
│ ├── **init**.py
│ ├── health.py # Health check schemas
│ └── [add more schemas] # Add validation schemas
│
├── tests/ # Test suite
│ ├── **init**.py
│ ├── conftest.py # Pytest configuration
│ └── [add test files] # Add tests here
│
├── alembic/ # Database migrations
│ ├── versions/ # Migration files (auto-generated)
│ │ ├── [migration files] # Auto-generated migrations
│ │ └── .gitkeep
│ ├── env.py # Alembic environment config
│ ├── alembic.ini # Alembic configuration
│ └── script.py.mako # Migration template
│
├── .env.example # Environment template
├── .env.docker # Docker compose environment
├── .gitignore # Git ignore rules
├── docker-compose.yml # PostgreSQL + pgAdmin setup
├── pyproject.toml # Project metadata & dependencies
├── requirements.txt # Pip requirements (alternative)
├── README.md # Full documentation
├── SETUP.md # Setup guide
├── setup.ps1 # Setup script (Windows)
├── setup.sh # Setup script (Unix)
└── STRUCTURE.md # This file

# KEY FILES EXPLAINED

Entry Points:
└─ app/main.py FastAPI app with CORS configured

Configuration:
├─ app/core/config.py Settings from environment
├─ .env.example Environment template
├─ .env.docker Docker environment
└─ pyproject.toml Dependencies & project config

Database:
├─ app/db/database.py Async SQLAlchemy engine
├─ app/models/base.py Base model & mixins
├─ app/models/waste_bin.py Example model
├─ alembic/env.py Migration config
└─ docker-compose.yml PostgreSQL setup

API:
├─ app/api/v1/**init**.py Router setup
├─ app/api/v1/health.py Health endpoints
└─ [add v1 routes] Add new endpoints

Validation:
├─ app/schemas/health.py Pydantic models
└─ [add schemas] Add validation

Testing:
├─ tests/conftest.py Pytest fixtures
└─ [add tests] Add test files

Dependencies:
├─ pyproject.toml Dependencies via uv
└─ requirements.txt Dependencies via pip

# FOLDER PURPOSES

/app Main Python package containing the API
/app/api API endpoints organized by version
/app/core Configuration, security, constants
/app/db Database connection and session management
/app/models SQLAlchemy ORM models mapping to database tables
/app/schemas Pydantic models for request/response validation
/tests Pytest test files and configuration
/alembic Database migration scripts and configuration
/alembic/versions Auto-generated migration files

# TECHNOLOGY STACK (Latest 2026 Versions)

Framework & Server:
• FastAPI 0.135.0 - Modern async web framework
• Uvicorn 0.44.0 - ASGI server
• Pydantic 2.10.0 - Data validation

Database:
• PostgreSQL 16+ - Relational database
• SQLAlchemy 2.1.0 - Async ORM
• asyncpg 0.31.0 - High-performance async driver
• Alembic 1.14.0 - Database migrations

Package Management:
• uv (latest) - Fast Python package manager
• Python 3.10+ - Python runtime

Development:
• pytest 7.4.4 - Testing framework
• ruff 0.4.0 - Linting
• black 24.4.0 - Code formatting
• mypy 1.11.0 - Type checking

# QUICK COMMANDS

Setup:
uv venv --python 3.10
.venv\\Scripts\\Activate.ps1 # Windows
source .venv/bin/activate # Unix
uv sync

Run:
fastapi dev app/main.py # Development
uvicorn app.main:app # Production

Database:
docker-compose up -d # Start PostgreSQL
alembic upgrade head # Apply migrations
alembic revision --autogenerate -m "msg"

Testing:
pytest
pytest -v
pytest --cov=app

Code Quality:
black app tests
ruff check app tests
mypy app

# ADDING NEW FEATURES

1. Create Database Model:
   └─ app/models/your_model.py

2. Create Pydantic Schema:
   └─ app/schemas/your_schema.py

3. Create API Routes:
   └─ app/api/v1/your_route.py

4. Include in Router:
   └─ app/api/v1/**init**.py

5. Generate Migration:
   └─ alembic revision --autogenerate -m "Add your model"

6. Apply Migration:
   └─ alembic upgrade head

7. Add Tests:
   └─ tests/test_your_feature.py

# CORS CONFIGURATION

Pre-configured for Vite React frontend at:
• http://localhost:5173 (Vite default)
• http://127.0.0.1:5173

Modify in app/core/config.py or .env:
CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]

# NEXT STEPS

1. Run SETUP.md for complete setup instructions
2. Start PostgreSQL: docker-compose up -d
3. Create .env from .env.example
4. Start API: fastapi dev app/main.py
5. Visit http://localhost:8000/docs
   """

if **name** == "**main**":
print(PROJECT_STRUCTURE)
