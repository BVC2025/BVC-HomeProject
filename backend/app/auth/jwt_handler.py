from jose import jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
from jose import JWTError

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY") or "dev-secret-change-me"
ALGORITHM = os.getenv("ALGORITHM") or "HS256"


def create_token(data: dict, expires_hours: int = 24):

    payload = data.copy()

    payload["exp"] = datetime.utcnow() + timedelta(
        hours=expires_hours
    )

    token = jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return token


def verify_token(token: str):

    try:

        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        return payload

    except JWTError:

        return None
