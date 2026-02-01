export async function deleteUserData(token) {
  const response = await fetch("http://localhost:8000/api/delete-data/", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: "DELETE" }), // optional safety check
  });

  if (!response.ok) {
    throw new Error(`Failed to delete user data: ${response.statusText}`);
  }

  return await response.json();
}


