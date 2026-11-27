using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// An SSH_ASKPASS program for the SFTP subprocess. OpenSSH provides the prompt
// as an argument and receives the answer on its private stdout pipe.
internal static class ConexumSshAskpass
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] private static extern uint GetFileType(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public IntPtr ExitStatus, PebAddress, AffinityMask, BasePriority, ProcessId, ParentId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass,
        out ProcessBasicInformation info, int length, out int resultLength);

    private static Process OpenParent()
    {
        ProcessBasicInformation info;
        int length;
        using (var self = Process.GetCurrentProcess())
        {
            if (NtQueryInformationProcess(self.Handle, 0, out info, Marshal.SizeOf(typeof(ProcessBasicInformation)), out length) != 0)
                return null;
            return Process.GetProcessById(info.ParentId.ToInt32());
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string destination = Environment.GetEnvironmentVariable("CONEXUM_SFTP_DESTINATION");
        if (args.Length == 0 || String.IsNullOrWhiteSpace(destination)) return 1;
        string mode = Environment.GetEnvironmentVariable("SSH_ASKPASS_PROMPT");
        string prompt = String.Join(" ", args);
        bool notice = mode == "none";
        // OpenSSH may request first-use host verification with an ordinary
        // askpass challenge rather than the optional confirmation hint.
        bool confirm = mode == "confirm" || prompt.TrimEnd().EndsWith("(yes/no/[fingerprint])?", StringComparison.Ordinal);
        if (!notice && GetFileType(GetStdHandle(-11)) != 3) return 1; // FILE_TYPE_PIPE

        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool spanish = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "es";
            using (var parent = OpenParent())
            using (var form = new Form())
            using (var timer = new Timer { Interval = 400 })
            {
                if (parent == null || parent.HasExited) return 1;
                timer.Tick += delegate { if (parent.HasExited) form.Close(); };
                form.Text = "Conexum SFTP — OpenSSH";
                form.Font = SystemFonts.MessageBoxFont;
                form.AutoScaleMode = AutoScaleMode.Font;
                form.ClientSize = new Size(470, 210);
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MinimizeBox = form.MaximizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                var layout = new TableLayoutPanel {
                    Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(14)
                };
                layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                var host = new Label {
                    Text = "SFTP · " + destination, UseMnemonic = false, AutoSize = true,
                    MaximumSize = new Size(425, 0), Margin = new Padding(3, 0, 3, 8)
                };
                var promptArea = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
                promptArea.Controls.Add(new Label {
                    AutoSize = true, MaximumSize = new Size(410, 0), UseMnemonic = false,
                    Text = prompt
                });
                var response = new TextBox {
                    Dock = DockStyle.Fill, UseSystemPasswordChar = true, Name = "Response",
                    AccessibleName = "OpenSSH response", Visible = !notice && !confirm
                };
                var buttons = new FlowLayoutPanel {
                    AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft
                };
                var accept = new Button { AutoSize = true, DialogResult = DialogResult.OK,
                    Text = notice ? (spanish ? "Cerrar" : "Close") : confirm ? (spanish ? "Sí" : "Yes") : (spanish ? "Aceptar" : "OK") };
                var cancel = new Button { AutoSize = true, DialogResult = DialogResult.Cancel,
                    Text = confirm ? "No" : (spanish ? "Cancelar" : "Cancel") };
                buttons.Controls.Add(accept);
                if (!notice) buttons.Controls.Add(cancel);
                layout.Controls.Add(host, 0, 0);
                layout.Controls.Add(promptArea, 0, 1);
                layout.Controls.Add(response, 0, 2);
                layout.Controls.Add(buttons, 0, 3);
                form.Controls.Add(layout);
                form.AcceptButton = confirm ? cancel : accept;
                form.CancelButton = notice ? accept : cancel;
                form.Shown += delegate {
                    if (confirm) cancel.Focus();
                    else if (notice) accept.Focus();
                    else response.Focus();
                };
                timer.Start();
                if (form.ShowDialog() != DialogResult.OK || parent.HasExited) return 1;
                if (notice) return 0;
                string answer = confirm ? "yes" : response.Text;
                response.Clear();
                if (answer.IndexOfAny(new char[] { '\r', '\n', '\0' }) >= 0) return 1;
                byte[] reply = Encoding.UTF8.GetBytes(answer);
                try
                {
                    using (Stream pipe = Console.OpenStandardOutput())
                    {
                        pipe.Write(reply, 0, reply.Length);
                        pipe.WriteByte(10);
                        pipe.Flush();
                    }
                }
                finally { Array.Clear(reply, 0, reply.Length); }
            }
            return 0;
        }
        catch (ArgumentException) { return 1; } // Parent already exited.
        catch (InvalidOperationException) { return 1; }
        catch (IOException) { return 1; }
    }
}
