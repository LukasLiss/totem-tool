import { LogoutButton } from '@/components/logout-button';
import { LOCAL_MODE } from '@/lib/env';
import {FileUploadValidator} from './react_component/fileuploadvalidator';
import UserFileSelect from './react_component/userfileselect';

export function UploadView(){

return (
    <div className="max-md:w-full">
        {!LOCAL_MODE && (
            <div className="flex justify-end px-6 pt-6">
                <LogoutButton />
            </div>
        )}
        <div className="flex flex-col items-center md:flex-row md:items-start">
            <FileUploadValidator/>
            <UserFileSelect/>
        </div>
    </div>
)
}

export default UploadView;
