# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `calendar.calendarList.get` |
| `events_list` | read | optional | `calendar.calendarList.get`, `calendar.events.list` |
| `calendar_today` | read | optional | `calendar.calendars.get`, `calendar.events.list` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `gws.calendar` | events | `meeting` | `events_list` | free |
| `gws.calendar.today` | snapshot | `agenda` | `calendar_today` | free |

### Actions

None.

### Bus events

`rpc.gws.changed`
<!-- /generated:capabilities -->

## Notes

The example's provider calls are invented; the manifest is the part the contract checks.
