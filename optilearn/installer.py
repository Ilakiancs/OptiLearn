"""
OptiLearn Installation Wizard
A GUI installer that sets up OptiLearn on the teacher's laptop.
Run: python installer.py
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import subprocess
import sys
import os
import shutil
import venv


class InstallerApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("OptiLearn Setup")
        self.root.geometry("640x480")
        self.root.resizable(False, False)
        self.root.configure(bg='#ffffff')

        try:
            ico = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'optilearn.ico')
            self.root.iconbitmap(ico)
        except Exception:
            pass

        self.main_thread_id = threading.get_ident()
        self.shortcut_var = tk.BooleanVar(value=True)
        self.startup_var = tk.BooleanVar(value=True)
        self.e4b_var = tk.BooleanVar(value=False)
        self.installed_dir = None
        self.shortcut_created = False
        self.ollama_startup_created = False

        self.install_dir = tk.StringVar(
            value=os.path.join(os.path.expanduser("~"), "OptiLearn")
        )
        self.current_step = 0
        self.steps = [
            self._step_welcome,
            self._step_location,
            self._step_options,
            self._step_installing,
            self._step_complete,
        ]
        self._show_step(0)
        self.root.mainloop()

    def _clear(self):
        for w in self.root.winfo_children():
            w.destroy()

    def _header(self, title, subtitle):
        header = tk.Frame(self.root, bg='#1a73e8', height=80)
        header.pack(fill='x')
        header.pack_propagate(False)
        tk.Label(header, text='OptiLearn', font=('Segoe UI', 11, 'bold'),
                 bg='#1a73e8', fg='white').pack(side='left', padx=20, pady=10)
        tk.Label(header, text=title, font=('Segoe UI', 14, 'bold'),
                 bg='#1a73e8', fg='white').place(relx=0.5, rely=0.35, anchor='center')
        tk.Label(header, text=subtitle, font=('Segoe UI', 9),
                 bg='#1a73e8', fg='white').place(relx=0.5, rely=0.7, anchor='center')

    def _footer(self, back_cmd=None, next_cmd=None, next_text='Next >'):
        footer = tk.Frame(self.root, bg='#f8f9fa', height=60)
        footer.pack(side='bottom', fill='x')
        footer.pack_propagate(False)
        if next_cmd:
            tk.Button(footer, text=next_text, command=next_cmd,
                      bg='#1a73e8', fg='white', font=('Segoe UI', 10, 'bold'),
                      relief='flat', padx=20, pady=8, cursor='hand2').pack(
                      side='right', padx=20, pady=10)
        if back_cmd:
            tk.Button(footer, text='< Back', command=back_cmd,
                      bg='#f8f9fa', fg='#5f6368', font=('Segoe UI', 10),
                      relief='flat', padx=20, pady=8, cursor='hand2').pack(
                      side='right', padx=4, pady=10)

    def _show_step(self, idx):
        self.current_step = idx
        self._clear()
        self.steps[idx]()

    def _step_welcome(self):
        self._header("Welcome to OptiLearn", "Let's get you set up")
        body = tk.Frame(self.root, bg='white')
        body.pack(fill='both', expand=True, padx=40, pady=30)

        tk.Label(body, text='\U0001f393', font=('Segoe UI', 48), bg='white').pack(pady=(0, 16))
        tk.Label(body,
            text='OptiLearn is an offline-first AI tutoring platform\n'
                 'for refugee classrooms. This wizard will install\n'
                 'everything you need in a few minutes.',
            font=('Segoe UI', 11), bg='white', fg='#202124',
            justify='center').pack()
        tk.Label(body,
            text='Requirements: 8GB RAM minimum • 15GB free disk space',
            font=('Segoe UI', 9), bg='white', fg='#5f6368').pack(pady=(16, 0))

        self._footer(next_cmd=lambda: self._show_step(1))

    def _step_location(self):
        self._header("Installation Location", "Choose where to install OptiLearn")
        body = tk.Frame(self.root, bg='white')
        body.pack(fill='both', expand=True, padx=40, pady=30)

        tk.Label(body, text='Install OptiLearn in:',
                 font=('Segoe UI', 11), bg='white', fg='#202124').pack(anchor='w')

        dir_frame = tk.Frame(body, bg='white')
        dir_frame.pack(fill='x', pady=8)

        entry = tk.Entry(dir_frame, textvariable=self.install_dir,
                        font=('Segoe UI', 10), relief='solid', bd=1)
        entry.pack(side='left', fill='x', expand=True, ipady=6)

        tk.Button(dir_frame, text='Browse',
                  command=lambda: self.install_dir.set(
                      filedialog.askdirectory() or self.install_dir.get()),
                  bg='#f8f9fa', fg='#202124', relief='flat',
                  font=('Segoe UI', 9), padx=12, cursor='hand2').pack(side='right', padx=(8, 0))

        tk.Checkbutton(body, text='Create desktop shortcut',
                      variable=self.shortcut_var,
                      font=('Segoe UI', 10), bg='white', fg='#202124').pack(
                      anchor='w', pady=(16, 4))
        tk.Checkbutton(body, text='Start Ollama automatically with Windows',
                      variable=self.startup_var,
                      font=('Segoe UI', 10), bg='white', fg='#202124').pack(anchor='w')

        self._footer(
            back_cmd=lambda: self._show_step(0),
            next_cmd=lambda: self._show_step(2)
        )

    def _step_options(self):
        self._header("AI Model Options", "Choose your setup")
        body = tk.Frame(self.root, bg='white')
        body.pack(fill='both', expand=True, padx=40, pady=20)

        tk.Label(body, text='OptiLearn uses Gemma 4 E2B as the primary AI model.\n'
                            'Optionally download the Deep Mode model for richer responses.',
                 font=('Segoe UI', 10), bg='white', fg='#5f6368',
                 justify='left').pack(anchor='w', pady=(0, 16))

        frame1 = tk.Frame(body, bg='#f0f7ff', relief='solid', bd=1)
        frame1.pack(fill='x', pady=4)
        tk.Label(frame1, text='✅ Gemma 4 E2B  (Required — 7.2GB)',
                 font=('Segoe UI', 11, 'bold'), bg='#f0f7ff', fg='#1a73e8').pack(
                 anchor='w', padx=16, pady=12)
        tk.Label(frame1, text='Fast responses, works on 8GB RAM laptops',
                 font=('Segoe UI', 9), bg='#f0f7ff', fg='#5f6368').pack(
                 anchor='w', padx=16, pady=(0, 12))

        frame2 = tk.Frame(body, bg='white', relief='solid', bd=1)
        frame2.pack(fill='x', pady=4)
        tk.Checkbutton(frame2, text='Gemma 4 E4B  (Deep Mode — 9.6GB)',
                        variable=self.e4b_var,
                        font=('Segoe UI', 11, 'bold'), bg='white', fg='#202124').pack(
                        anchor='w', padx=16, pady=12)
        tk.Label(frame2, text='More detailed explanations, requires 16GB RAM',
                 font=('Segoe UI', 9), bg='white', fg='#5f6368').pack(
                 anchor='w', padx=16, pady=(0, 12))

        self._footer(
            back_cmd=lambda: self._show_step(1),
            next_cmd=lambda: self._show_step(3),
            next_text='Install Now'
        )

    def _step_installing(self):
        self._header("Installing OptiLearn", "Please wait...")
        body = tk.Frame(self.root, bg='white')
        body.pack(fill='both', expand=True, padx=40, pady=20)

        self.status_label = tk.Label(body, text='Starting installation...',
                                      font=('Segoe UI', 11), bg='white', fg='#202124')
        self.status_label.pack(pady=(20, 8))

        self.progress = ttk.Progressbar(body, length=500, mode='determinate')
        self.progress.pack(pady=8)

        self.detail_label = tk.Label(body, text='',
                                     font=('Segoe UI', 9), bg='white', fg='#5f6368',
                                     wraplength=500)
        self.detail_label.pack(pady=4)

        self.log_text = tk.Text(body, height=8, font=('Consolas', 8),
                                bg='#1e1e1e', fg='#a8ff78', relief='flat',
                                state='disabled')
        self.log_text.pack(fill='x', pady=(16, 0))

        threading.Thread(target=self._run_installation, daemon=True).start()

    def _on_ui(self, fn):
        if threading.get_ident() == self.main_thread_id:
            fn()
        else:
            self.root.after(0, fn)

    def _log(self, message):
        def write():
            self.log_text.configure(state='normal')
            self.log_text.insert('end', message + '\n')
            self.log_text.see('end')
            self.log_text.configure(state='disabled')

        self._on_ui(write)

    def _update_status(self, text, detail='', progress=0):
        def update():
            self.status_label.config(text=text)
            self.detail_label.config(text=detail)
            self.progress['value'] = progress

        self._on_ui(update)

    def _run_installation(self):
        try:
            install_dir = os.path.abspath(self.install_dir.get())
            self.installed_dir = install_dir
            self.shortcut_created = False
            self.ollama_startup_created = False
            os.makedirs(install_dir, exist_ok=True)
            src_dir = os.path.dirname(os.path.abspath(__file__))
            venv_python = self._venv_python(install_dir)

            steps = [
                ('Copying files...', 'Copying OptiLearn to ' + install_dir, 10,
                 lambda: self._copy_files(src_dir, install_dir)),
                ('Preparing configuration...', 'Creating .env from .env.example when needed', 20,
                 lambda: self._ensure_env_file(install_dir)),
                ('Preparing Python environment...', 'Creating .venv and installing requirements', 30,
                 lambda: self._install_python_packages(install_dir)),
                ('Building frontend...', 'npm install && npm run build', 55,
                 lambda: self._build_frontend(install_dir)),
                ('Downloading Gemma 4 E2B...', '~7.2GB download, this takes a while', 70,
                 lambda: subprocess.run(['ollama', 'pull', 'gemma4:e2b'], check=True)),
                ('Generating icons...', 'Creating app icons', 85,
                 lambda: subprocess.run([venv_python,
                     'scripts/generate_icons.py'], cwd=install_dir, check=True)),
                ('Creating shortcuts...', 'Setting up desktop icon', 95,
                 lambda: self._create_shortcuts(install_dir)),
                ('Configuring startup...', 'Adding optional Ollama startup launcher', 98,
                 lambda: self._configure_ollama_startup(install_dir)),
            ]

            if self.e4b_var.get():
                steps.insert(4, (
                    'Downloading Gemma 4 E4B...', '~9.6GB download', 77,
                    lambda: subprocess.run(['ollama', 'pull', 'gemma4:e4b'], check=True)
                ))

            for label, detail, prog, fn in steps:
                self._update_status(label, detail, prog)
                self._log(f'> {label}')
                fn()
                self._log('  Done')

            self._update_status('Installation complete!', '', 100)
            self.root.after(500, lambda: self._show_step(4))

        except Exception as e:
            self._log(f'ERROR: {e}')
            self._on_ui(lambda: messagebox.showerror(
                'Installation Needs Attention',
                f'Setup stopped here:\n\n{e}\n\nPlease check the log and try again.'
            ))

    def _venv_python(self, install_dir, windowed=False):
        scripts_dir = os.path.join(install_dir, '.venv', 'Scripts' if os.name == 'nt' else 'bin')
        exe = 'pythonw.exe' if windowed and os.name == 'nt' else ('python.exe' if os.name == 'nt' else 'python')
        return os.path.join(scripts_dir, exe)

    def _copy_files(self, src_dir, install_dir):
        if os.path.normcase(os.path.abspath(src_dir)) == os.path.normcase(os.path.abspath(install_dir)):
            self._log('  Source and install folder are the same; using the current folder.')
            return
        shutil.copytree(
            src_dir,
            install_dir,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(
                '__pycache__', '*.pyc', '.git', 'node_modules', '.venv',
                'dist', '=5.0'
            ),
        )

    def _ensure_env_file(self, install_dir):
        env_path = os.path.join(install_dir, '.env')
        example_path = os.path.join(install_dir, '.env.example')
        if os.path.exists(env_path):
            self._log('  Existing .env preserved.')
            return
        if os.path.exists(example_path):
            shutil.copyfile(example_path, env_path)
            self._log('  Created .env from .env.example.')

    def _install_python_packages(self, install_dir):
        venv_dir = os.path.join(install_dir, '.venv')
        python_exe = self._venv_python(install_dir)
        if not os.path.exists(python_exe):
            venv.create(venv_dir, with_pip=True)
        subprocess.run([python_exe, '-m', 'pip', 'install', '--upgrade', 'pip', '-q'], check=True)
        subprocess.run(
            [python_exe, '-m', 'pip', 'install', '-r', 'requirements.txt', '-q'],
            cwd=install_dir,
            check=True,
        )

    def _build_frontend(self, install_dir):
        fe_dir = os.path.join(install_dir, 'frontend')
        subprocess.run(['npm', 'install'], cwd=fe_dir, check=True, capture_output=True)
        subprocess.run(['npm', 'run', 'build'], cwd=fe_dir, check=True, capture_output=True)

    def _create_shortcuts(self, install_dir):
        if not self.shortcut_var.get():
            self._log('  Desktop shortcut skipped by installer option.')
            return
        try:
            subprocess.run([self._venv_python(install_dir), 'scripts/create_shortcut.py'],
                          cwd=install_dir, check=True, capture_output=True)
            self.shortcut_created = True
        except Exception as exc:
            self._log(f'  Shortcut could not be created automatically: {exc}')

    def _configure_ollama_startup(self, install_dir):
        if not self.startup_var.get():
            self._log('  Ollama startup skipped by installer option.')
            return
        if os.name != 'nt':
            self._log('  Ollama startup shortcut is only created on Windows.')
            return
        startup_dir = os.path.join(
            os.environ.get('APPDATA', ''),
            'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
        )
        if not startup_dir or not os.path.isdir(startup_dir):
            self._log('  Windows Startup folder was not found.')
            return
        vbs_path = os.path.join(startup_dir, 'OptiLearn Start Ollama.vbs')
        command = 'CreateObject("WScript.Shell").Run "ollama serve", 0, False\n'
        with open(vbs_path, 'w', encoding='ascii') as f:
            f.write(command)
        self.ollama_startup_created = True

    def _step_complete(self):
        self._header("OptiLearn is Ready!", "Installation complete")
        body = tk.Frame(self.root, bg='white')
        body.pack(fill='both', expand=True, padx=40, pady=30)

        tk.Label(body, text='OptiLearn', font=('Segoe UI', 32, 'bold'),
                 bg='white', fg='#1a73e8').pack(pady=(0, 16))
        shortcut_line = (
            'A desktop shortcut has been added.\n'
            if self.shortcut_created else
            'Open OptiLearn.bat from the install folder to start.\n'
        )
        startup_line = (
            'Ollama will start with Windows.\n'
            if self.ollama_startup_created else
            ''
        )
        tk.Label(body,
            text='OptiLearn has been installed.\n\n'
                 f'{shortcut_line}'
                 f'{startup_line}'
                 'You can launch the app now.',
            font=('Segoe UI', 11), bg='white', fg='#202124',
            justify='center').pack()

        tk.Button(body, text='Launch OptiLearn Now',
                  command=self._launch_and_exit,
                  bg='#1a73e8', fg='white', font=('Segoe UI', 12, 'bold'),
                  relief='flat', padx=24, pady=12, cursor='hand2').pack(pady=(24, 0))

    def _launch_and_exit(self):
        install_dir = self.installed_dir or os.path.abspath(self.install_dir.get())
        pythonw = self._venv_python(install_dir, windowed=True)
        if not os.path.exists(pythonw):
            pythonw = 'pythonw' if os.name == 'nt' else sys.executable
        subprocess.Popen([pythonw, os.path.join(install_dir, 'desktop.py')],
                        cwd=install_dir)
        self.root.destroy()


if __name__ == '__main__':
    InstallerApp()
