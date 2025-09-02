import React, { useState } from 'react';

import {FileUploadValidator} from './component/fileuploadvalidator';
import { FileLoader } from './component/fileloader';


export function UploadView(){

return (
    <div>
        <FileUploadValidator/>;
        <FileLoader/>
    </div>
)
}

export default UploadView;