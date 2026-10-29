import { LogoutButton } from '@/components/logout-button';
import { LOCAL_MODE } from '@/lib/env';
import {FileUploadValidator} from './react_component/fileuploadvalidator';
import UserFileSelect from './react_component/userfileselect';

export function UploadView(){

return (
    <div>
        {!LOCAL_MODE && (
            <div className="flex justify-end px-6 pt-6">
                <LogoutButton />
            </div>
        )}
        <div className="flex flex-row">
            <FileUploadValidator/>
            <UserFileSelect/>
        </div>
    </div>
)
}

export default UploadView;
