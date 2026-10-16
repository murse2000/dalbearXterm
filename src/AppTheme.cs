using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class AppTheme {
  public static bool Dark { get; private set; }
  public static Color Background { get { return ColorTranslator.FromHtml(Dark ? "#1c222b" : "#f0f2f4"); } }
  public static Color Foreground { get { return ColorTranslator.FromHtml(Dark ? "#dce5ef" : "#222222"); } }
  static Color Surface { get { return ColorTranslator.FromHtml(Dark ? "#202833" : "#ffffff"); } }
  static Color Border { get { return ColorTranslator.FromHtml(Dark ? "#455365" : "#b8bec5"); } }
  static Color Hover { get { return ColorTranslator.FromHtml(Dark ? "#314a65" : "#d4e5f2"); } }
  public static void Set(string theme) {
    Dark = theme == "dark";
    ToolStripManager.Renderer = new ToolStripProfessionalRenderer(new MenuColors());
    foreach (Form form in Application.OpenForms) Apply(form);
  }
  public static void Apply(Form form) {
    ApplyControl(form);
    // 지원하는 Windows에서는 제목 표시줄도 앱의 선택과 일치시킨다.
    int dark = Dark ? 1 : 0, background = ColorTranslator.ToWin32(Background), foreground = ColorTranslator.ToWin32(Foreground);
    DwmSetWindowAttribute(form.Handle, 20, ref dark, 4);
    DwmSetWindowAttribute(form.Handle, 35, ref background, 4);
    DwmSetWindowAttribute(form.Handle, 36, ref foreground, 4);
    form.Invalidate(true);
  }
  static void ApplyControl(Control control) {
    control.BackColor = control is TextBoxBase ? Surface : Background; control.ForeColor = Foreground;
    var button = control as Button;
    if (button != null) {
      button.UseVisualStyleBackColor = false; button.FlatStyle = FlatStyle.Flat;
      button.FlatAppearance.BorderColor = Border; button.FlatAppearance.MouseOverBackColor = Hover; button.FlatAppearance.MouseDownBackColor = Hover;
    }
    var bar = control as ProgressBar;
    if (bar != null) { SetWindowTheme(bar.Handle, "", ""); bar.ForeColor = ColorTranslator.FromHtml(Dark ? "#80c7ff" : "#2f6f9d"); }
    var strip = control as ToolStrip;
    if (strip != null) { strip.Renderer = ToolStripManager.Renderer; ApplyItems(strip.Items); }
    foreach (Control child in control.Controls) ApplyControl(child);
  }
  static void ApplyItems(ToolStripItemCollection items) {
    foreach (ToolStripItem item in items) {
      item.BackColor = Background; item.ForeColor = Foreground;
      var menu = item as ToolStripMenuItem;
      if (menu != null) { menu.DropDown.BackColor = Background; menu.DropDown.ForeColor = Foreground; menu.DropDown.Renderer = ToolStripManager.Renderer; ApplyItems(menu.DropDownItems); }
    }
  }
  sealed class MenuColors : ProfessionalColorTable {
    public override Color MenuStripGradientBegin { get { return Background; } }
    public override Color MenuStripGradientEnd { get { return Background; } }
    public override Color ToolStripDropDownBackground { get { return Background; } }
    public override Color ImageMarginGradientBegin { get { return Background; } }
    public override Color ImageMarginGradientMiddle { get { return Background; } }
    public override Color ImageMarginGradientEnd { get { return Background; } }
    public override Color MenuItemSelected { get { return Hover; } }
    public override Color MenuItemSelectedGradientBegin { get { return Hover; } }
    public override Color MenuItemSelectedGradientEnd { get { return Hover; } }
    public override Color MenuItemPressedGradientBegin { get { return Hover; } }
    public override Color MenuItemPressedGradientMiddle { get { return Hover; } }
    public override Color MenuItemPressedGradientEnd { get { return Hover; } }
    public override Color MenuItemBorder { get { return Border; } }
    public override Color MenuBorder { get { return Border; } }
    public override Color SeparatorDark { get { return Border; } }
    public override Color SeparatorLight { get { return Background; } }
    public override Color CheckBackground { get { return Hover; } }
    public override Color CheckSelectedBackground { get { return Hover; } }
    public override Color CheckPressedBackground { get { return Hover; } }
  }
  public static DialogResult ShowMessage(IWin32Window owner, string text, string title, MessageBoxButtons buttons = MessageBoxButtons.OK, MessageBoxIcon icon = MessageBoxIcon.None, MessageBoxDefaultButton defaultButton = MessageBoxDefaultButton.Button1) {
    using (var form = new Form { Text = title, Font = new Font("Malgun Gothic", 10F), FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterParent, ShowInTaskbar = false }) {
      var ownerForm = owner as Form;
      form.Icon = icon == MessageBoxIcon.Warning ? SystemIcons.Warning : icon == MessageBoxIcon.Error ? SystemIcons.Error : ownerForm == null ? SystemIcons.Information : ownerForm.Icon;
      var height = TextRenderer.MeasureText(text, form.Font, new Size(540, 0), TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl).Height;
      form.ClientSize = new Size(580, Math.Max(150, Math.Min(520, height + 100)));
      var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Padding = new Padding(16) };
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      layout.Controls.Add(new TextBox { Text = text.Replace("\r\n", "\n").Replace("\n", Environment.NewLine), Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12) });
      var footer = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(0) };
      var cancel = new Button { Text = buttons == MessageBoxButtons.YesNo ? "아니요" : "확인", DialogResult = buttons == MessageBoxButtons.YesNo ? DialogResult.No : DialogResult.OK, AutoSize = true, MinimumSize = new Size(80, 30) };
      footer.Controls.Add(cancel); form.CancelButton = cancel; form.AcceptButton = cancel;
      if (buttons == MessageBoxButtons.YesNo) {
        var yes = new Button { Text = "예", DialogResult = DialogResult.Yes, AutoSize = true, MinimumSize = new Size(80, 30) }; footer.Controls.Add(yes);
        if (defaultButton != MessageBoxDefaultButton.Button2) form.AcceptButton = yes;
      }
      layout.Controls.Add(footer); form.Controls.Add(layout); Apply(form); form.ActiveControl = (Control)form.AcceptButton;
      return form.ShowDialog(owner);
    }
  }
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
  [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr window, string app, string list);
}
