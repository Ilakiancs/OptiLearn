' OptiLearn Silent Launcher
' Starts desktop.py via pythonw with no CMD or console window visible.
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base    = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

Sub LogLaunch(message)
    On Error Resume Next
    Set logFile = fso.OpenTextFile(base & "\optilearn_launcher.log", 8, True)
    logFile.WriteLine Now & " " & message
    logFile.Close
    On Error GoTo 0
End Sub

' Prefer the venv pythonw so the right packages are available
venvPyw = base & "\.venv\Scripts\pythonw.exe"
If fso.FileExists(venvPyw) Then
    selectedPyw = venvPyw
    LogLaunch "Using venv pythonw: " & selectedPyw
Else
    selectedPyw = "pythonw"
    LogLaunch "Venv pythonw missing; falling back to PATH pythonw"
End If

cmd = """" & selectedPyw & """ """ & base & "\desktop.py"""
LogLaunch "Launching: " & cmd

On Error Resume Next
sh.Run cmd, 0, False
If Err.Number <> 0 Then
    LogLaunch "Launch failed: " & Err.Number & " " & Err.Description
    Err.Clear
End If
On Error GoTo 0
