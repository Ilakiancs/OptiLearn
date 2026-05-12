' OptiLearn Silent Launcher
' Starts desktop.py via pythonw with no CMD or console window visible.
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base    = fso.GetParentFolderName(WScript.ScriptFullName)

' Prefer the venv pythonw so the right packages are available
venvPyw = base & "\.venv\Scripts\pythonw.exe"
If fso.FileExists(venvPyw) Then
    sh.Run """" & venvPyw & """ """ & base & "\desktop.py""", 0, False
Else
    sh.Run "pythonw """ & base & "\desktop.py""", 0, False
End If
