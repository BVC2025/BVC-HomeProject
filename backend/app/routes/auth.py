from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from app.database.database import get_db
from app.models.models import RootUser

from app.schemas.auth_schema import (
    RootUserCreate,
    LoginSchema
)

from app.auth.jwt_handler import (
    create_token
)

from app.auth.auth_bearer import (
    get_current_user
)

router = APIRouter()

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


# =========================
# CREATE ROOT USER
# =========================

@router.post("/create-root-user")
def create_root_user(
    data: RootUserCreate,
    db: Session = Depends(get_db)
):

    try:

        # hash password
        hashed_password = pwd_context.hash(
            data.PASSWORD
        )

        # create object
        new_user = RootUser(
            EMAIL=data.EMAIL,
            PASSWORD=hashed_password,
            VENDOR_ID=data.VENDOR_ID,
            STATUS="ACTIVE"
        )

        # save to db
        db.add(new_user)

        db.commit()

        db.refresh(new_user)

        return {
            "message": "Root user created successfully",
            "user_id": new_user.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# LOGIN
# =========================

@router.post("/login")
def login(
    data: LoginSchema,
    db: Session = Depends(get_db)
):

    try:

        # check user
        user = db.query(RootUser).filter(
            RootUser.EMAIL == data.EMAIL
        ).first()

        if not user:

            raise HTTPException(
                status_code=404,
                detail="User not found"
            )

        # verify password
        valid_password = pwd_context.verify(
            data.PASSWORD,
            user.PASSWORD
        )

        if not valid_password:

            raise HTTPException(
                status_code=401,
                detail="Invalid password"
            )

        # create jwt token
        token = create_token({
            "user_id": user.ID,
            "email": user.EMAIL,
            "vendor_id": user.VENDOR_ID
        })

        return {
            "access_token": token,
            "token_type": "bearer"
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# PROTECTED ROUTE
# =========================

@router.get("/me")
def get_me(
    current_user=Depends(get_current_user)
):

    return {
        "message": "Protected route working",
        "user": current_user
    }