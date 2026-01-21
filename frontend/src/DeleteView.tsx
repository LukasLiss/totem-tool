import { deleteUserData } from './api/projectApi';
import { Button } from './components/ui/button';


export function DeleteView(){
const handleDelete = async () => {
    const token = localStorage.getItem("access_token");
    try {
      await deleteUserData(token);
      console.log('Successfull deletion')
    } catch (err) {
      console.error("Deletion failed:", err);
      alert("Deletion failed");
    }
  };
return (
<div className='flex flex-col items-center p-40 ' >
    <Button variant="outline" onClick={ handleDelete }>Delete all projects of user</Button>
</div>
)}

export default DeleteView;