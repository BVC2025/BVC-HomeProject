from fastapi import HTTPException


def raise_not_found(entity: str):
    raise HTTPException(
        status_code=404,
        detail=f"{entity} not found"
    )


def raise_bad_request(message: str):
    raise HTTPException(
        status_code=400,
        detail=message
    )


def raise_internal_server_error(error: Exception):
    raise HTTPException(
        status_code=500,
        detail=str(error)
    )