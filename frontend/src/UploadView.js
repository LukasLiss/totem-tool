import React, { useState } from 'react';

import {FileUploadValidator} from './component/fileuploadvalidator';
import { FileLoader } from './component/fileloader';
import UserFileSelect from './component/userfileselect';


export function UploadView(){

return (
    <div>
        <UserFileSelect/>
        <FileUploadValidator/>
        
    </div>
)
}

export default UploadView;