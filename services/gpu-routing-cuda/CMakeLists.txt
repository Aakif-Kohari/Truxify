cmake_minimum_required(VERSION 3.18)
project(gpu_routing_cuda CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(CheckLanguage)
check_language(CUDA)

option(
    TRUXIFY_ENABLE_CUDA
    "Build the VRP sources with the CUDA compiler when available"
    ${CMAKE_CUDA_COMPILER}
)

if(TRUXIFY_ENABLE_CUDA)
    if(NOT CMAKE_CUDA_COMPILER)
        enable_language(CUDA)
    endif()
    set(CMAKE_CUDA_STANDARD 17)
    set(CMAKE_CUDA_STANDARD_REQUIRED ON)
else()
    message(STATUS "CUDA toolkit not found or disabled; building VRP sources as host C++ for tests")
endif()

include_directories(include)

add_library(gpu_vrp
    src/cuda_vrp.cu
)

add_executable(gpu_vrp_tests
    src/cuda_vrp_tests.cu
)

target_link_libraries(gpu_vrp_tests PRIVATE gpu_vrp)

if(TRUXIFY_ENABLE_CUDA)
    set_source_files_properties(
        src/cuda_vrp.cu
        src/cuda_vrp_tests.cu
        PROPERTIES LANGUAGE CUDA
    )
else()
    set_source_files_properties(
        src/cuda_vrp.cu
        src/cuda_vrp_tests.cu
        PROPERTIES
            LANGUAGE CXX
            COMPILE_OPTIONS "-x;c++"
    )
endif()

enable_testing()
add_test(NAME gpu_vrp_tests COMMAND gpu_vrp_tests)
