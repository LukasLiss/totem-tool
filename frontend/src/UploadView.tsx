import React, { useState } from 'react';

import {FileUploadValidator} from './react_component/fileuploadvalidator';
import { FileLoader } from './react_component/fileloader';
import UserFileSelect from './react_component/userfileselect';


export function UploadView(){

return (
    <div className="flex flex-row">
        <FileUploadValidator/>
        <UserFileSelect/>
        
        
    </div>
)
}

export default UploadView;