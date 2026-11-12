# Projects

A project is one event log and everything you build on it: the dashboards, the saved models,
the stored SQL queries and the images. Uploading an event log creates a project; the switcher
at the top of the sidebar moves between them.

## Exporting a project

Open the project switcher and click the **download icon** next to a project. You get a single
`.totem` file containing the whole project — the event log included — and you choose where to
save it.

The file is a zip with a different name on purpose. A `.zip` is expanded automatically on
download by some browsers, which would leave you with a folder rather than something you can
load back into TOTeM. If you ever want to look inside, rename it to `.zip`.

## Importing a project

Drag a `.totem` file onto **Upload a new file**, the same place an event log goes, and click
**Validate & Upload**. The project is recreated with everything in it, and TOTeM opens it.

Importing always creates a **new** project; it never merges into or overwrites an existing one.
Import the same file twice and you get two separate projects.

Because a project file carries its own event log, models, queries and images, the dashboards
inside it find everything they reference — unlike importing a single dashboard, which has to
reconnect to whatever the project you import it into already has.

## Sample projects

The sample projects on [totem-tool.com](https://totem-tool.com) are ordinary `.totem` files.
Download one and import it to see a finished project without building anything first.

## What does not travel

- **Who can see the project.** An imported project belongs to you alone.
- **Anything in the OCEL editor** that was not saved to the project.
- A project exported from a **newer version of TOTeM** than the one you are importing into. The
  file says which version wrote it, and the import tells you rather than failing silently.
