"""Your business logic goes here. This example reads fictional data, never a real customer system."""

DEFINITIONS = [{
    "name": "get_service_status",
    "description": "Look up FICTIONAL example telecom service status for an area. Label it as sample data.",
    "parameters": {
        "type": "object",
        "properties": {"area": {"type": "string", "enum": ["north", "central", "south"]}},
        "required": ["area"],
        "additionalProperties": False,
    },
    "defer_until_eot": True,
}]


async def get_service_status(arguments):
    """Replace this sample dictionary with an awaited, authorized backend lookup."""
    area = arguments.get("area")
    if area not in ("north", "central", "south") or set(arguments) != {"area"}:
        raise ValueError("Invalid function arguments")
    sample = {
        "north": "Example disruption: engineers are investigating; no restoration time is available.",
        "central": "Example service is operating normally.",
        "south": "Example service is operating normally.",
    }
    return {"sample_data": True, "area": area, "status": sample[area]}


# Only registered handlers can execute. Never eval a model-supplied name or command.
HANDLERS = {"get_service_status": get_service_status}
