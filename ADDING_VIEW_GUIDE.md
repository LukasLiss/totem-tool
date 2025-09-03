### Adding a new view

The general idea is to add a view in the backend/api folder (or create a new folder for bigger projects like authentification). You then need to reference your new view in view.py in the same folder, which will automatically be referenced by the main url.py file.
The next step is to create a corresponding file and then function for your functionality in frontend/api. Here the actions provided by the view model are used for viewset.ModelViewSet, these are:

- `list` → GET /files/
- `create` → POST /files/
- `retrieve` → GET /files/<id>/
- `update` → PUT /files/<id>/
- `partial_update` → PATCH /files/<id>/
- `destroy` → DELETE /files/<id>/

and they are generally accessed by using the corresponding URLs, e.g. "http://localhost:8000/api/files/" to add or fetch any files.

### Functions that can be used right now
For creating an own API processFile or NoE in backend/api/views.py should be a good inspiration, as it already shows a routine to load a file.
The userfiles are currently saved in a format with
['id', 'file', 'uploaded_at'] as attributes (columns in database).
## fileApi.js

processFile -> get the number of Events for a chosen file

getUserFiles -> get a list of the files for the current user

uploadFile -> upload a file for a user

### User Authentification

This should work automatically now. If you add a viewset please include

```bash
permission_classes = [IsAuthenticated]
```
if you have a class and
```bash
@permission_classes([IsAuthenticated])
```
if you want to add a function.

On the fronend side include 
```bash
headers: {
      Authorization: `Bearer ${token}`, 
    },
```
in fetch request for an api and load tokens in a function using
```bash
const token = localStorage.getItem("access_token")
```

