"""Voice-assistant business handlers. One file per intent.

Every handler follows the same protocol:

    handle(db, session, entities, employee) -> HandlerReply

The handler owns:
  • collecting missing slots from the user
  • enforcing business rules (balance, holidays, quotas, policies)
  • writing to the DB via the existing service layer / SQLAlchemy
  • deciding when the conversation is complete

Handlers NEVER call Gemini. Gemini only feeds them extracted entities.
"""
