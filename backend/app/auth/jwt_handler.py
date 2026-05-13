from jose import jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
from jose import JWTError

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")


def create_token(data: dict):

    payload = data.copy()

    payload["exp"] = datetime.utcnow() + timedelta(days=1)

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