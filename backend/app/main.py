from fastapi import FastAPI

from app.database.database import engine
from app.models.models import Base
from app.routes.users import router as users_router
from app.routes.auth import router as auth_router
from app.routes.vendor import router as vendor_router
from app.routes.project import router as project_router
from app.routes.task import router as task_router
app = FastAPI()

Base.metadata.create_all(bind=engine)
app.include_router(task_router)
app.include_router(project_router)
app.include_router(users_router)
app.include_router(auth_router)
app.include_router(vendor_router)


@app.get("/")
def home():

    return {
        "message": "Server running"
    }