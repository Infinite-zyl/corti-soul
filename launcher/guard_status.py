"""Read today's actual fallback counter; never present the retired counter as current."""
from datetime import datetime, timezone, timedelta, date


def fallback_usage(state, config, now=None):
    now = now or datetime.now(timezone(timedelta(hours=8)))
    today = now.astimezone(timezone(timedelta(hours=8))).date().isoformat()
    day = state.get('day')
    try:
        date.fromisoformat(day)
    except (ValueError, TypeError):
        day = None
    count = state.get('paidSwitches')
    if isinstance(day, str) and day < today:
        count = 0
    elif day != today or type(count) is not int or count < 0:
        count = None
    limit = config.get('maxPaidSwitchesPerDay', 12)
    if type(limit) is not int or limit < 0:
        limit = None
    return {'switches': count, 'maxSwitches': limit, 'counterDay': today}
