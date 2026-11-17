package net.christopherrutherford.statocyst.automotive

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Mirrors the phone design tokens in apps/desktop/src/styles.scss. */
object AutomotiveColors {
    val Abyss = Color(0xFF03070F)
    val Abyss900 = Color(0xFF050A18)
    val Abyss800 = Color(0xFF081326)
    val Abyss700 = Color(0xFF0B1A33)
    val Cyan = Color(0xFF38E1FF)
    val CyanSoft = Color(0xFF7FE9FF)
    val CyanDeep = Color(0xFF1B9FD0)
    val Violet = Color(0xFFA78BFA)
    val VioletDeep = Color(0xFF7466F5)
    val Pearl = Color(0xFFF2FBFF)
    val Text = Color(0xFFE9F4FF)
    val Muted = Color(0xFFA9C0D8)
    val MutedDim = Color(0xFF8BA4C0)
    val Line = Color(0x2494C5FF)
    val LineStrong = Color(0x4294C5FF)
    val Panel = Color(0xB3091224)
    val PanelStrong = Color(0xEB0A1529)
    val Danger = Color(0xFFFF6B8A)
}

private val scheme = darkColorScheme(
    primary = AutomotiveColors.Cyan,
    onPrimary = AutomotiveColors.Abyss,
    primaryContainer = AutomotiveColors.CyanDeep,
    onPrimaryContainer = AutomotiveColors.Abyss,
    secondary = AutomotiveColors.Violet,
    onSecondary = AutomotiveColors.Abyss,
    background = AutomotiveColors.Abyss900,
    onBackground = AutomotiveColors.Text,
    surface = AutomotiveColors.Abyss800,
    onSurface = AutomotiveColors.Text,
    surfaceVariant = AutomotiveColors.PanelStrong,
    onSurfaceVariant = AutomotiveColors.Muted,
    outline = AutomotiveColors.LineStrong,
    error = AutomotiveColors.Danger,
)

private val typography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 34.sp,
        letterSpacing = (-0.8).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 26.sp,
        letterSpacing = (-0.5).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 15.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 13.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        letterSpacing = 0.2.sp,
    ),
)

@Composable
fun StatocystAutomotiveTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        typography = typography,
        content = content,
    )
}
