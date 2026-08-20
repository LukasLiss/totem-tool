"""
Dynamic system prompt builder incorporating UI context and knowledge RAG.
"""

from .retriever import retrieve_knowledge


def build_system_prompt(user, context: dict = None) -> str:
    """Build the base system prompt with context and knowledge."""
    if not isinstance(context, dict):
        context = {}
    view_mode = context.get("current_view", "overview")
    file_id = context.get("selected_file_id", "None")

    prompt = f"""You are the TOTeM Process Mining Assistant.
Active View: {view_mode}
Active File ID: {file_id}
User: {getattr(user, 'username', 'anonymous')}
"""
    return prompt
