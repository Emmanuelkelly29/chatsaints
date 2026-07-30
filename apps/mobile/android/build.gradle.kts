allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Compile every module (app and all plugins) with the same NDK.
// Keeps the whole build on one toolchain instead of per-plugin defaults.
val projectNdkVersion = "28.2.13676358"
subprojects {
    fun applyNdkVersion() {
        extensions.findByName("android")?.let { ext ->
            if (ext is com.android.build.gradle.BaseExtension) {
                ext.ndkVersion = projectNdkVersion
            }
        }
    }
    // evaluationDependsOn(":app") above means :app is already evaluated
    // by the time this block runs; configure it directly in that case.
    if (state.executed) applyNdkVersion() else afterEvaluate { applyNdkVersion() }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
