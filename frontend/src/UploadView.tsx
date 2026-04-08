import {FileUploadValidator} from './react_component/FileUploadValidator';
import UserFileSelect from './react_component/UserfileSelect';


export function UploadView(){

return (
    <div className="flex flex-row">
        <FileUploadValidator/>
        <UserFileSelect/>
        
        
    </div>
)
}

export default UploadView;