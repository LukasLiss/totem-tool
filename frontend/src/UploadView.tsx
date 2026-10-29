import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {FileUploadValidator} from './react_component/fileuploadvalidator';
import UserFileSelect from './react_component/userfileselect';

const LOCAL_MODE = Boolean(import.meta.env.VITE_LOCAL_MODE);

export function UploadView(){
    const navigate = useNavigate();

return (
    <div>
        {!LOCAL_MODE && (
            <div className="flex justify-end px-6 pt-6">
                <Button
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => navigate("/logout")}
                >
                    <LogOut />
                    Log out
                </Button>
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
